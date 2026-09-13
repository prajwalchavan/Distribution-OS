# Merge review — qa/b2-dos112-settle (DOS-112 Day-end settle 400, repair of the lean-backend-platform blocker)

Fable, 2026-09-13. Branch dd5ffeb + 2137755 on base 84afe34 (d1c7da0 is an ancestor). Read-only: code, diff, tests, lane reports.

**Decision:** MERGE

## What the branch does (matches the preferred fix in lean-backend-platform.md §Blockers 1, exactly)
- `backend/libs/contracts/src/delivery.ts:1430` path `/delivery/trips/{id}/settle` → `/delivery/trips/{tripId}/settle` (+ comment). Input and output schemas untouched; no other procedure moved (diff is 1 line + comment).
- `backend/libs/core/src/modules/tenancy/tenant.guard.ts` `PATH_FIELD_REDIRECTS` and the `route` argument are gone; the plain same-name path/body check stays and its comment now states the rule ("a route that creates a row under a record names its segment after that record, never `{id}`").
- `backend/tools/smoke-endpoints.mts:2104` `pathParams: { tripId: chain.tripId }`; the sweep at :2734 already used the trip id.
- Nothing needed in `permissions.ts:733` (keyed by procedure name), `examples.ts:3909` (`buildExamples` splits by the route's param names) or `delivery.controller.ts:107` (reads `input.tripId`).

## Tests prove the wire, not a hand-built URL
- `frontend/libs/api-client/src/client.test.ts:500-557` builds the package's real `createApiClient` (only global `fetch` stubbed) and calls `desk.api.delivery.trips.settle` with `day-end.tsx:158-165`'s exact input; asserts URL `/delivery/trips/<trip>/settle`, body `{id, idempotencyKey, handedOverCashPaise, acceptVariance, note}` (no `tripId`) and that the settlement id is not in the URL. Red on main (URL carried the settlement id), green here.
- `backend/libs/core/src/modules/delivery/delivery.spec.ts:2967-3085` sends exactly that request to the real Nest app + guard: 200, `item.id` = settlement, `item.tripId` = trip, trip `settled`, replay returns the same settlement with one `trip_settlements` row; a body naming another trip still gets the guard's 400 and leaves the trip `closing`. Red on main (oRPC 400 `tripId` missing — same root cause, the `{id}` segment).
- Verifier additionally drove the real `OpenAPILink` over `app.inject` on both sides (400 before, 200 after) — the review's blocker reproduced and closed, not code-read.
- Sweep of all POST routes under `/{parent}/{id}/…` that create a child (claims lines/evidence/settlements/statements, docint pages, delivery stops/pod, orders lines, picks, GRN/cycle counts): every one names the parent `id` in the path and the child `lineId`/`evidenceId`/`settlementId`/`statementId`/`pageId`. Settle was the lone exception; none remains.

## Blockers
None.

## Minors (not blocking)
1. `docs/plans/delivery.md:36` still says POST `/delivery/trips/{id}/settle` with `tripId: id`; change to `/delivery/trips/{tripId}/settle` and note `id` = settlement id travels in the body. Hand-written plan doc, not generated; can ride the merge commit or the next docs pass.
2. `tenant.guard.ts:150` `assertPathMatchesBody` still runs before the bearer check: an anonymous mismatched call gets 400 instead of 401. Pre-existing (lean-backend-platform minor), leave as tracked.
3. `QA/findings/12-batch2-new-findings.md:214` S-113 moves from PROBE RUNNING to CONFIRMED (probe 400 reproduced) and FIXED by this merge; `QA/STATE.md:31` still owes the live `pnpm smoke --run-tag` for DOS-112.
4. The README request.json keeps `tripId` in the body next to `id` (renderer shows the full input; the guard accepts it when it equals the path). Consistent with every other `{id}` route; no change asked.

## Conflicts
- With main now: none. `git merge-tree main qa/b2-dos112-settle` clean; main gained only `QA/STATE.md` (4376f29) since the base.
- lean-delivery-collect (order 14, owns `contracts/src/delivery.ts`, `delivery.spec.ts`, `seed-demo/delivery.ts`): NOT started (no branch, no worktree), so it branches from main after this merge — no conflict. Tell its builder: the settle route is `/delivery/trips/{tripId}/settle`, and `delivery.spec.ts` now ends with the DOS-112 block (its DOS-071 case appends after it; keep both if a tail conflict ever appears).
- No other open lane touches the guard, the smoke tool or the settle route (b2-dos167 and b2-docs22 are app/docs lanes).

## READMEs
10 regenerated in 2137755 (delivery/manager/owner/retailer/warehouse services + the five app READMEs); `docs:readme:check` clean. Only the settle row, heading, 403 message and the curl URL changed; the curl URL now carries the trip id (`01a06d0b…` = request `tripId`) and request `id` (`01a06d17…`) equals `item.id` in the response — the URL semantics the lean review called wrong are now right. After merging: rebuild `@dos/contracts` + `@dos/core` in the main checkout and restart the services (STATE:54 rule) and the manager Metro, since the frontend links the contracts dist.

## Walks (owed, A.12 platform + focused regression; log to QA/14-regression-results.md)
1. Manager app Day-end settle (`money/day-end.tsx`) on the web desk and on Android against running services: a `closing` trip settles green, the trip shows `settled`, one settlement row; then a variance beyond tolerance → 409 needs-owner path unchanged.
2. `pnpm smoke` (`--run-tag`) on dos_qa so `delivery.trips.settle`'s renamed `pathParams` and the sweep are exercised: 0 BROKEN.
3. Security check stays green by spec (manager-service 346/346, delivery-service 262/262 permission matrices); no re-walk needed beyond the smoke's 403 rows.
