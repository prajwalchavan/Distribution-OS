# Merge review — lean-backend-platform (qa/b2-lean-backend-platform, 6 commits 861da8d..16d05b6)
Reviewer: Fable (architect), 2026-09-13. Read-only: diff, group notes, findings, contract, oRPC internals, the apps' callers.

**Decision:** MERGE AFTER FIXES

## Blockers

1. **DOS-112 breaks every real Day-end settle from the manager app.** `PATH_FIELD_REDIRECTS` (`tenant.guard.ts:350-351`) makes the guard
   compare the path `{id}` of `POST /delivery/trips/{id}/settle` with `body.tripId`. But the apps call through `OpenAPILink` in compact
   mode (`frontend/libs/api-client/src/client.ts:223`), which fills `{id}` from **`input.id` — the NEW settlement id** — and deletes it
   from the body (`@orpc/openapi-client …/openapi-client.B2Q9qU5m.mjs:97-105`). `manager-app/app/money/day-end.tsx:158-165` sends
   `id: meta.id, tripId: input.tripId`, so the wire request is `POST /delivery/trips/<settlementId>/settle` + `{tripId: <trip>}` →
   the redirect sees two different ids → 400 on every settle. `delivery.spec.ts:1713` passes only because it hand-builds the URL
   with the trip id. Verified by code reading; not executed.
   **Fix (preferred):** rename the path to `/delivery/trips/{tripId}/settle` (`contracts/src/delivery.ts:1430`) and drop the redirect —
   the link then fills the path from `tripId`, keeps `id` in the body, the guard's plain same-name check is right, the README example
   is right (today it shows the settlement id in the path), and the handler already reads `input.tripId`
   (`delivery.controller.ts:107`). Update `smoke-endpoints.mts:2104` to `pathParams: { tripId: chain.tripId }`; `pnpm docs:readme`.
   `delivery.ts` is owned by lean-delivery-collect (order 14, not started) — a one-line touch, tell that lane. **Fallback** if the
   contract must stay: remove the settle entry from `PATH_FIELD_REDIRECTS` (unchecked, not broken). Either way: walk Day-end settle
   on web + Android before merging.

## Minors (not blocking)

- DOS-112: `assertPathMatchesBody` runs before the bearer check (`tenant.guard.ts:150`) — an anonymous mismatched call gets 400,
  not 401. Move it after `verify()`/`requireServed`. Note the check only bites hand-built clients: the OpenAPI link never sends the
  path field in the body, so for app traffic it is a no-op — which is the finding's scope (integrations), fine.
- DOS-028: `order.confirm` is also written on the SELF-confirm at submit (`orders.service.ts:293` → `confirmInTx` → `:434`), so every
  flag-free order by a rep or a shop adds an audit row; the desk's trail fills with routine confirms and, at lakhs of orders, doubles
  the write. Consider auditing the confirm only when it clears a gate or a person calls `orders.confirm` directly.
- DOS-127: the terminal-order path (`approvals.service.ts:121-136`) writes no audit row and does not close the bargain request the
  gate names (`bargains.decideInTx` is skipped), so a decided-stale gate leaves its request `requested`.
- DOS-160: option (a) chosen (stored reply returned untouched). A replayed reply may lack a field the typed client now declares
  required — screens must tolerate it (they do today). `box.response` is filled by ANY `runIdempotent` hit in the call
  (`idempotency.ts:79`); a handler that nests a second `idempotent()` could hand back the inner reply when the outer output
  fails validation. No such handler exists; note for the future.
- DOS-127 (business rule, correct): a shop's cancel now expires the gate under `asSystem` — the actor stays the shop, only the
  DB role escalates for the one UPDATE; `approvals_update` WITH CHECK already allows `status='expired'`. Good.

## Conflicts

- None with main now: `git merge-tree main qa/b2-lean-backend-platform` is clean; main gained only QA/docs commits since base 663c6f3
  (h10-console, h13-owner-support, h5 DOS-003 are all in the base).
- Later groups share files: lean-manager-money (10), lean-admin-support (15), lean-sales-orders-pricing (16), lean-owner-money-approvals
  (17), lean-manager-order-lifecycle (18) all own `orders.service.ts` / `approvals.service.ts` / `orders.spec.ts` / `platform-admin.spec.ts`
  / `support.spec.ts`. They branch after this merges; expect append-conflicts at the tail of `orders.spec.ts` (DOS-028/127 blocks
  sit just before the DOS-003 section) — keep both blocks.

## READMEs

- As submitted: none (contract-neutral; `docs:readme:check` clean per builder). With the preferred fix: `owner-service`,
  `manager-service` READMEs and the owner/manager app READMEs regenerate (settle path) — not a blocker.

## Walks still needed

- DOS-112: manager Day-end settle (web desk + Android) after the fix; `pnpm smoke --run-tag` with all eight services up.
- DOS-028: owner web Settings > Audit at desk and phone widths shows `approval.decide` and `order.confirm` rows with the manager's name.
- DOS-127: retailer app (Android) cancels a held order with a bargain → owner web Approvals queue and Today "Needs you" drop it.
- DOS-151: re-render INV/0826 (stored PDFs keep '?'); read the footer in the delivery Android print preview and the web PDF.
- DOS-160: none (backend-only; the DB-backed spec is the proof). Same-day `pnpm smoke` no longer needs `--run-tag` for DOS-003.

## Defects outside the group

- `orders.service.ts:497` cancelInTx expires gates but never closes the `bargain_requests` they name (no `OrderCancelled` consumer in
  pricing): a rep's or shop's cancel leaves the request `requested` in Rate requests / retailer `deals.tsx` forever.
- `docs/examples.ts:3909-3915` the published `delivery.trips.settle` example puts the settlement id in the path (`{id}`) and the trip in
  the body — wrong URL semantics even before this group; fixed for free by the `{tripId}` rename above.
- `orders.service.ts` cancel (`cancelInTx`) writes no `audit_log` row — a manager cancelling a shop's order is still untraced (finding
  DOS-028's "every state transition"; out of this fix's stated scope).
