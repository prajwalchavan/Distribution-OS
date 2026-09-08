# 01 — Test strategy (draft, Phase 0)

The question this programme answers: **can a real FMCG distributor run their whole business on Distribution OS, reliably, safely and profitably?** Everything below serves that; nothing below counts as done because a test is green.

## 1. What we are testing (from `00-system-understanding.md`)

- 8 backend services + 1 worker on one Postgres 17 (shared schema, RLS + FORCE, `withTenant` / `withSystem`), contract-first oRPC over a 1 059-line permission matrix.
- 7 Expo universal apps (web + Android + iOS from one codebase), each pointed at its own service; `@dos/offline` SQLite delta-sync in the field apps.
- Three seeded distributorships (`tarsun`, `sai-distributors`, `kalyan-agencies`) with staff in every role and shops that buy from more than one — the natural fixture for isolation tests.
- Money: integer paise, `priceOrder()` as the single pricing engine, invoice issued at pack, receipts with allocations, journals with a balance trigger, ageing, credit limit as an approval gate at submit.
- Stock: append-only `stock_ledger`, derived `stock_balances`, lots with expiry, `reservations` table, pick → pack → load → deliver each writing the ledger.
- Order machine: draft → submitted → confirmed → picking → packed → dispatched → delivered / partially_delivered → closed, plus cancelled; invoice and trip/stop machines alongside. `closed` is confirmed unreachable in code (divergence 3).

## 2. Stage 1 — is the product right? (by hand, on the running apps)

Order of roles, one per session: **Owner** (with the six-place money trace on one delivered order — the first thing that must be true), **Manager**, **Sales Rep**, **Warehouse**, **Delivery**, **Retailer**, **Admin**. Each role's day is scripted from `docs/22` §4 flows and `docs/23` screen inventory, then walked in the browser (Playwright records every screen at desk + phone width) and on the Pixel 7 emulator for the field apps (sales, warehouse, delivery, retailer); iOS is rendered in Expo Go and screenshotted, input-blocked until a headless tap path exists (ENV.md §5.4).

Then Phase 2 chains the roles across apps and platforms and verifies every hop in UI, API and DB, including the days that go wrong. Findings are categorised per Charter A.7 and prioritised P0 → P3; nothing is changed in the product without approval.

What "P0" will mean here, concretely: the six-place total disagrees; a receipt or invoice can be duplicated; stock goes negative or a ledger row can be altered; anything from tenant A is visible to tenant B; a critical role cannot finish its day.

## 3. Stage 2 — is the product safe? (after "the product is right")

| Layer | What exists today | What Stage 2 adds |
|---|---|---|
| Unit | 10 domain specs (money, GST, pricing, state machines) | table-driven money/tax/pricing cases with the awkward boundaries; mutation testing on money + ledger |
| Integration | 31 DB-backed specs in `libs/core`, RLS guarantee test | per-module write paths and transaction boundaries against a **fresh** DB; migrations forward on populated data |
| Contract | 8 service specs incl. `describePermissionMatrix` (every endpoint × every role) | response-schema snapshots; app-expectation vs backend checks |
| Smoke | `pnpm smoke` (1 588 calls, not in CI, dirties the tenant) | a < 2 min smoke that signs in per role and runs one order to cash, asserting the six-place match; in CI |
| E2E | **none** | Playwright (web) — the Phase 0 harness in `QA/tools` is the seed; Android via adb/uiautomator now, Maestro or Appium later; iOS via Appium XCUITest if the WDA build succeeds |
| Data | seed-demo (three tenants) | `qa:seed` (150+ SKUs, every order state the code supports, the retailer archetypes), `reconcile.ts`, snapshot/restore |
| Load | none | k6 against the services at 100k orders / 1M ledger rows / 5k retailers |

CI today runs backend unit+integration, and frontend lint/typecheck/build only — the frontend job runs no tests, and smoke is never run. Wiring the four suites into CI is a Phase 6 deliverable.

## 4. Evidence and hygiene

- Every claim cites a screenshot, command output, query result or request/response (Charter A.4). Phase 0 evidence: `QA/evidence/phase0/{web,android,ios}/`.
- The shared `dos` database is polluted (ENV.md §6). Proposal: Stage 1 walkthroughs on a fresh `dos_qa`; Stage 2 destructive work only ever against `dos_qa` / `dos_test`.
- Test data is fictional except that the seed carries Tarsun Enterprises' real legal identity (name, GSTIN, address, logo) — flagged to the founder in Phase 0.

## 5. Open questions for the founder (carried in STATE.md)

1. Run Stage 1 on a fresh `dos_qa` database rather than the polluted `dos`?
2. iOS input: allow the Simulator window (with Accessibility for AppleScript) / a physical iPhone / accept Appium if the WDA build works — or keep iOS render-only?
