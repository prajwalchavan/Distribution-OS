# Ready-to-paste rows for `QA/findings/12-batch2-new-findings.md`

This block did **not** write into the main checkout: its environment rules say never to edit the main checkout
and to write nothing under `QA/` outside `QA/evidence/batch2/walks/`, which contradicts the instruction to
file findings there. Safer reading taken. **Please paste these in** — otherwise S-164..S-167 are unregistered.

> **PASTED 2026-09-21 — do not paste again.** All four rows are now in the findings table as **S-164..S-167**, unchanged.
> The collision with the money-web block (which filed S-166..S-169 an hour later, at 09:28) was repaired by renumbering the
> LATER-filed rows: money-web's **S-166 → S-183** and **S-167 → S-184**. The numbers in this file still mean what they say.

Numbering: S-160..S-163 were already taken (DOS-167 judge 2, DOS-181 walk), so this starts at **S-164**.
Evidence for all four: `QA/evidence/batch2/walks/smoke-failures.md`.

---

## Rows for the S-table

| # | Raised in | Suspected/observed defect | Status |
|---|---|---|---|
| S-164 | smoke-failures walk (2026-09-21) | `backend/libs/core/src/modules/notifications/inbound.service.ts` — `notifications.inbound.create` did not translate a `23505` on `inbound_messages_pkey`, so a client id re-used under a **different** idempotency key answered **500 Internal server error** instead of the house's CONFLICT (orders/trips/vehicles/GRNs/documents/tenancy all do). The only BROKEN in `pnpm smoke` runs 2 and 3. P2. | **FIXED** on lane `qa/b2-smoke-failures` `71b03e0`, with a spec proved to fail without the guard |
| S-165 | smoke-failures walk (2026-09-21) | `backend/libs/core/src/docs/examples.ts` — `notifications.inbound.create` (DOS-103) was the one create in its module absent from the `freeSlots` registry, so `slotOf()` always answered 0 and the published example named `createdId(path,'id',0)` for ever: "Try it out" worked exactly once per database, then 500. Same root as the harness's own "hard-coded id" example defect. P2. | **FIXED** on lane `qa/b2-smoke-failures` `50cab0c`; example now walks to a free slot, pressed twice answers 200/200 |
| S-166 | smoke-failures walk (2026-09-21) | `backend/libs/core/src/docs/examples.spec.ts:1075-1112` — the S-149 census asserts every **active membership** of the demo tenant has an own in-app notice, but the only thing that writes those notices is `pnpm db:seed`'s backfill. `pnpm smoke` creates staff via `tenancy.staff.create` (ten `demo.docs.staff*` users in five runs) and they get none, so the census goes red after any smoke run until the next seed. Measured both directions: red after smoke, green immediately after `pnpm db:seed`. Not a race, not a product defect — same family as S-149/156/157. P3. | **CONFIRMED — needs a decision** (scope the census to seeded staff, or re-seed in the test). Owner: whoever owns S-149 |
| S-167 | smoke-failures walk (2026-09-21) | Both API docs pages hard-code the **root-relative** spec URL `/docs/openapi.json`. On a per-service port that is correct; in **all-in-one mode** (`:3100`, docs/26 §7, the least-cost deployment) the spec is at `/<service>/docs/openapi.json` and the root is **404**, so Swagger UI shows "Failed to load API definition — Fetch error Not Found /docs/openapi.json" and Scalar renders empty, for **every** service. The same header also advertises "port 3006" and `http://localhost:3000/auth/login`, neither of which serves in that mode. P2. | **CONFIRMED on the web** (screenshots) — needs a DOS block. NOT fixed: `./openapi.json` is not a safe one-liner (page served at `/retailer/docs` with no trailing slash), it needs a prefix-aware URL |

---

## If S-167 is promoted to a DOS block, suggested wording

### DOS-XXX — In all-in-one mode every service's API docs page fails to load its own spec
Category: bug | Priority: P2 | Role: anyone reading the API docs (founder, integrators, QA) | Platform: web
Environment: worktree `b2-walks` base `f7095ad`, `backend/all-in-one` on `:3100` with `DOS_MODE=all WORKER_INLINE=1`.
Steps: start the all-in-one; open `http://127.0.0.1:3100/retailer/swagger` (or `/retailer/docs`).
Expected: the service's operations, with the published examples, ready to press.
Actual: Swagger UI — "Failed to load API definition. Fetch error Not Found /docs/openapi.json". Scalar — an
empty page with only a search box. Both pages request the root-relative `/docs/openapi.json`, which is 404 at
`:3100`; the spec is served at `/retailer/docs/openapi.json` (200), as is every other service's under its own
prefix.
Note: the page header additionally says "port 3006" and tells the reader to get a token from
`http://localhost:3000/auth/login`; in this mode auth is at `:3100/auth/auth/login`. All-in-one is the
founder's least-cost deployment mode (docs/26 §7), so this is how the docs will look in production.
Evidence: `QA/evidence/batch2/walks/smoke-failures-web-swagger-allinone.png`,
`smoke-failures-web-scalar-allinone.png`, and §6 of `smoke-failures.md`.
