# §B — PHASES

Run one phase per session. Grep to your phase heading; do not load this whole file. Later phases assume earlier ones passed — if exit criteria are unmet, say so and stop.

# STAGE 1 — IS THE PRODUCT RIGHT?

## Phase 0 — Understand the system & get it running

Do not ask me to explain the repository before inspecting it. Do not invent architecture that does not exist — document what is actually there.

1. Inspect. Use a subagent for the sweep. Determine exactly which applications exist and which are Web / iOS / Android / Backend-API / Admin / shared services. Understand:
frontend applications · backend applications · mobile applications · database · API architecture · authentication · authorization · roles · permissions · state management · routing · order lifecycle · inventory · payments · pricing · schemes · discounts · retailers · employees · warehouses · delivery · notifications · reports · file uploads · integrations · background jobs · queues · cron/schedulers · external services · deployment · environment configuration · logging · monitoring · existing tests · CI/CD
2. Get it running. Install everything needed (A.2). Bring up the DB, run migrations, start the API and web app, boot one Android emulator and one iOS simulator, launch the mobile apps. Identify how each application is actually executed and document the commands.
3. Create login accounts for every role: Owner, Manager, Warehouse, Delivery, Sales Rep, Retailer/Shopkeeper, Admin. Plus a handful of products, one retailer and one order — just enough to have something on screen.
4. Screenshot each running app.
5. Document the order lifecycle, the inventory ledger design, and the auth/permission model as implemented, not as designed. Divergences from the architecture blueprint in this repo are findings. Inventory existing tests and CI.

Write `QA/00-system-understanding.md` and `QA/ENV.md`. Draft `QA/01-test-strategy.md`.
Exit: you can log into every app as every role, with screenshots proving it. No review, no testing, no product changes in this phase.

## Phase 1 — Real-user role simulation

This is the priority phase. One role per session if they are large. You are not a QA engineer here — you are the person doing this job every day in Mumbai. Log in, do their entire real day, screenshot as you go, and note every single thing that is broken, missing, slow, confusing, or would make you stop using the app. Report what you saw — do not read the code to explain behaviour.

**Owner → `QA/02-owner-review.md`**
Login, dashboard review, sales review, inventory review, outstanding review, payment review, employee review, retailer review, product review, order review, reports, business analytics, operational monitoring.
"Can I understand the health of my business within a few minutes?"
Look for: missing KPIs, confusing dashboards, incorrect numbers, stale information, poor filtering, lack of actionable information, missing alerts, financial inconsistencies.
Money sanity check — do this once, here, and report it explicitly. Pick one delivered order. Trace its total across: order screen → invoice → payment record → retailer outstanding → Owner's revenue report → the database. All six must agree. If they do not, that is P0 and I need to know before we improve anything else.

**Manager → `QA/03-manager-review.md`**
Order review, approval and rejection, employee assignment, inventory visibility, retailer management, delivery coordination, payment tracking, operational monitoring, exceptions, escalations, reports.
"Can I run the daily operation without constantly calling people?"

**Warehouse → `QA/04-warehouse-review.md`**
Login, view pending orders, picking, quantity confirmation, substitutions if supported, packing, damaged stock, shortage, excess stock, inventory adjustments, stock receiving, returns, expiry handling, scanning/barcode if supported.
"Can I process orders quickly without mistakes?" Deliberately confirm incorrect quantities and verify inventory changes correctly.

**Delivery → `QA/05-delivery-review.md`**
Assigned deliveries, route/list, retailer details, order details, delivery confirmation, partial delivery, failed delivery, payment collection, proof of delivery, photo/signature if supported, GPS/location if supported, return handling, reassignment, offline operation, poor network, app backgrounding, app termination and reopening.
"Can I complete deliveries even with poor network?" Turn the network off and try.

**Sales Representative → `QA/06-sales-rep-review.md`**
Retailer discovery, retailer selection, retailer creation if allowed, product search, order creation, quantity changes, schemes, discounts, price visibility, credit availability, outstanding visibility, order submission, order modification, cancellation, repeat order, order history.
"Can I place an order at a shop in under a few minutes?"
Test the messy cases a real rep hits: wrong quantities, zero quantity, negative quantity, huge quantity, unavailable stock, discontinued products, changed prices, expired schemes, blocked retailer, retailer beyond credit limit.

**Retailer / Shopkeeper → `QA/07-retailer-review.md`**
Login, catalogue, prices, order creation, previous orders, outstanding, invoices, payment, delivery status, returns, complaints, notifications, profile, support/contact.
"Would a normal shopkeeper actually want to use this? Is it easier than calling my distributor?" Look for unnecessary complexity. If it is not easier, say so plainly.

**Admin → `QA/08-admin-review.md`**
Users, roles, permissions, configuration, products, organisations, system settings, audit logs, integrations, operational controls. Attempt privilege escalation.
"Can I manage the system safely?"

Then, across all roles, identify:
friction · unnecessary steps · confusing terminology · missing workflows · poor defaults · missing shortcuts · repetitive data entry · unclear statuses · poor mobile UX
Update `QA/STATE.md` after each role.

## Phase 2 — Cross-role end-to-end business flow

Run the chain the way it actually happens, switching apps as you go, verifying state at every hop in UI, API and DB:

```
Sales Rep → creates retailer order
   → Manager → approves
   → Warehouse → picks → packs
   → Delivery → receives assignment → delivers
   → Retailer → receives goods
   → Payment
   → Owner → sees revenue / inventory / outstanding
```

At every hop: did the next person get what they needed? Was anything lost, delayed, duplicated or silently wrong? Did every platform show the same state?
Then run it with the platforms split, as it happens in real life:

```
Sales Rep — Android  → creates order
Manager   — Web      → approves
Warehouse — Android/iOS → picks and packs
Delivery  — Android/iOS → delivers
Retailer  — Web/mobile  → views order
Owner     — Web      → checks inventory / payment / outstanding / reports
```

Then the days that go wrong: order rejected, cancelled mid-pick, partial delivery, failed delivery, delivery reassigned mid-route, return after delivery, partial payment, retailer refuses goods.
Write `QA/09-cross-role-workflows.md`.

## Phase 3 — Product gap analysis & change backlog

Compare what you actually saw in Phases 1–2 against the product requirements and architecture blueprint in this repo. Separate findings into the A.7 categories — do not mix them — and additionally group them for me as:

1. Broken — exists but does not work correctly
2. Missing — a distributor needs it and it is not there
3. Wrong — works, but produces the wrong business outcome or workflow

Missing features go in `QA/11-missing-features.md`. Business-logic problems go in `QA/10-business-logic-audit.md`.
Write the prioritised backlog to `QA/12-change-backlog.md`. Every item carries: ID · Title · Category · Priority · Affected Role · Affected Platform · Problem · Evidence · Expected Behaviour · Proposed Solution · Business Impact · Technical Impact · Acceptance Criteria · Regression Risk · Status.
Then give me the approval summary from A.9 and stop.

## Phase 4 — Implement approved changes

Only items I explicitly approved, nothing adjacent.
For each: checkpoint commit → read the relevant QA findings → understand the affected code → write a failing test reproducing the defect, named for its finding id → implement until it passes → run focused tests → run relevant integration tests → run relevant E2E tests → verify the affected flow by using the app again, with a screenshot → verify affected Web/iOS/Android flows → verify the Phase 2 cross-role chain still works → check database consistency → update the QA documentation.
Log to `QA/13-change-log.md`. Run the full A.12 regression standard and log to `QA/14-regression-results.md`.
Do not attempt a complete test suite in Stage 1 — behaviour is still moving. One characterisation test per fix is enough here; Phase 6 builds the real suite.
Then return to Phase 1 and re-walk the affected roles. Loop Phases 1→4 until I say "the product is right."

# STAGE 2 — IS THE PRODUCT SAFE?

Begins only after I say "the product is right."

## Phase 5 — Realistic test data & fixtures

Build an idempotent, re-runnable seed script (`qa:seed`) creating a realistic FMCG distribution environment. Realistic but fictional data.
Business: 2+ distinct distributor organisations/tenants (required for isolation tests); 1 distribution company per tenant; multiple warehouses if supported; realistic Mumbai-area operating locations; realistic employee hierarchy.
Products: a catalogue of 150+ SKUs containing beverages, snacks, biscuits, packaged food, dairy, personal care and household products; multiple brands; multiple pack sizes; cartons, cases and individual units. Include products with different prices, different margins, different GST slabs (0/5/12/18%), schemes, discounts, quantity-break pricing, stock limits, expiry dates, near-expiry batches, expired batches, discontinued status, damaged stock, low stock, zero stock, and multiple batches of the same SKU.
Retailers: small kirana, medium grocery store, supermarket, high-volume retailer, new retailer, blocked retailer, credit retailer, cash retailer, retailer near credit limit, retailer with overdue outstanding.
Employees: Owner, Manager, Warehouse Worker, Delivery Person, Sales Representative, Admin — multiple of each where the app supports it.
Orders: one in each of draft, pending, approved, rejected, picking, packed, dispatched, out for delivery, delivered, partially delivered, cancelled, returned, failed delivery, payment pending, paid. Use only states the application actually supports; identify missing states separately as findings — do not invent them.
Also build (`QA/tools/`): an API client per role, login fixtures, a DB snapshot/restore helper, a data generator for scale, and `reconcile.ts` which checks order total = invoice total = payments + outstanding across the whole dataset.
Exit: seeds clean from an empty DB; reconcile reports zero drift on fresh data. Drift on fresh data is P0.

## Phase 6 — Automated test suite: unit, integration, contract, smoke

Build the suite now, not earlier — unit tests written against behaviour Stage 1 was still changing would have been thrown away. Assess what already exists, then fill the ladder.
Unit — pure logic, no DB, no network, milliseconds. Cover every calculation where a wrong answer costs money: price resolution and slab selection, scheme application, discount stacking, CGST/SGST/IGST split and place-of-supply choice, rounding, invoice totalling, credit-available computation, outstanding and ageing buckets, ledger entry derivation, batch allocation (FEFO/FIFO as implemented), state-machine transition guards. Table-driven, with the awkward cases: zero, negative, boundary quantities, a scheme expiring on the boundary date, a discount larger than the line value, mixed GST slabs in one invoice, single-paisa rounding.
Integration — real database, real transactions, one module at a time: repository and query layer against the actual schema and RLS predicates; each service's write path including its transaction boundary; migrations up and down on a populated DB; queue producers and consumers; every external adapter with the third party stubbed at the HTTP boundary, not mocked in code.
API / contract — every endpoint: request and response schema, status codes, authentication, authorization, validation, error format, pagination. Snapshot response schemas so a breaking change fails CI. Verify each mobile app's expectations match what the backend actually returns — a mismatch here is what breaks a released app.
Smoke — under two minutes, proving the system is alive: login as each role, create an order, approve, pick, deliver, pay, and assert the six-place total match from Phase 1. Runs on every push and before every deploy.
Then:

* Wire all four into CI. A red suite blocks merge.
* Report coverage by layer, not as one number. Targets: money, ledger, pricing, tax and state-machine guards ≥ 90%; other services ≥ 70%; UI components as useful. A high global number that skips the pricing engine is worthless.
* Run mutation testing (Stryker or equivalent) on the money and ledger modules only. Coverage says a line ran; mutation says an assertion would have caught it being wrong.
* Convert every P0 and P1 fixed in Stage 1 into a permanent regression test named for its finding id.
* No flaky tests. A test that fails intermittently is fixed or deleted with a finding logged — never retried until green.

Write `QA/26-test-suite.md`: what exists at each level, coverage by layer, what is deliberately untested and why.
Exit: all four suites green in CI from a clean checkout, money paths genuinely covered.

## Phase 7 — Financial reconciliation, credit & returns

Invariant to prove after every scenario below: `order total = invoice total = payment total + outstanding`, per order, per retailer, and in aggregate.
Payments: full, partial, over-payment, failed, reversed, duplicate, cash, digital, before delivery, after delivery, against outstanding, refund, allocation across multiple invoices.
Credit & outstanding: credit limit, available credit, outstanding, overdue amounts and ageing buckets, payment allocation, partial payment, credit blocking, retailer reactivation, order creation near the credit limit, order creation beyond the credit limit. Verify all balances agree on every screen that shows them.
Returns, replacements & damage: full return, partial return, wrong product, wrong quantity, damaged product, expired product, replacement, refund, credit note if supported, return after payment, return after invoice, return after delivery, cancellation after payment. Verify both the inventory and the financial consequence of each.
Look for money being duplicated, lost, double-counted, incorrectly attributed or incorrectly rounded. Each is P0.
Data consistency: for each important transaction, compare UI, API, database, reports, invoices and notifications — they must represent the same business state. Perform a full reconciliation after each major workflow.
Write `QA/10-business-logic-audit.md` and `QA/18-data-consistency-report.md`.

## Phase 8 — Pricing, schemes, discounts & tax

Base price, retailer-specific price, quantity/slab pricing, schemes, promotional discounts, expiry of schemes, conflicting and stacked discounts, tax, rounding, manual discounts, unauthorised discounts, price changes after order creation but before invoice.
Tax: CGST/SGST vs IGST by place of supply, per-slab correctness, tax on discounted value, rounding rules, line-level vs invoice-level rounding.
The final amount must consistently match across UI, API, database, invoice, payment and reports. Script this comparison across 50+ generated orders.

## Phase 9 — Order state machine audit

Discover the actual state machines as implemented — the three independent lifecycles (Order Fulfillment / Delivery / Invoice-Payment). Document every state, allowed transitions, forbidden transitions, who can trigger each, and what database, inventory, financial and notification changes each causes.
Test invalid transitions: delivered → pending, cancelled → delivered, rejected → delivered, delivered → cancelled, duplicate approval, duplicate delivery, duplicate payment, approving an already-cancelled order, delivering an order never picked.
Ensure transitions are atomic and safe: force a failure mid-transition and confirm no half-applied state (order advanced but stock not moved; invoice created without ledger entry). Verify the three machines cannot desync — e.g. Invoice-Payment "paid" while Fulfillment says "cancelled".

## Phase 10 — Inventory lifecycle

Audit the complete lifecycle: `Purchase → Receive → Available → Reserved → Picked → Packed → Dispatched → Delivered` plus Damaged, Expired, Returned, Lost, Adjusted, Transferred.
The ledger is append-only by design — verify that is actually true. Attempt UPDATE and DELETE on ledger rows through every code path and directly.
Verify: stock never becomes negative unexpectedly; reservations work; reservation released on cancellation with no leak on rejection; concurrent orders are safe; batch tracking is correct through pick/pack/deliver/return; returned goods are handled correctly and re-enter at the right batch and condition; damaged goods never appear as sellable; expiry is handled correctly; inventory reports reconcile; and computed on-hand from the ledger equals reported stock for every SKU — script this.

## Phase 11 — Account & authentication testing

Registration, login, logout, password reset, password change, invalid credentials, expired credentials, expired session, multiple sessions, multiple devices, account activation, deactivation, reactivation, deleted users, duplicate accounts, invalid email/phone, weak passwords, brute-force protection, token expiration, token refresh, revoked sessions.
Verify logout actually invalidates access. Verify deactivated users cannot continue performing protected operations with an existing token.

## Phase 12 — Role-based access & multi-tenant isolation

Test authorization at the API/backend level, never through the UI. A hidden button is not an access control.
For every role (Owner, Manager, Warehouse, Delivery, Sales Rep, Retailer, Admin) determine: what they can view, create, edit, delete, approve, reject, assign; what financial data they can see; what personal data they can see; what inventory they can access; what reports they can access; what other users they can manage.
Then attempt unauthorized actions deliberately:

* horizontal escalation — Sales Rep A reads/edits Sales Rep B's orders and retailers
* vertical escalation — Warehouse approves an order; Delivery changes a price
* retailer A accesses retailer B's invoices, outstanding, prices
* accessing another employee's data; unauthorized financial actions
* multi-tenant isolation — with a valid Tenant A token, attempt every read and write against Tenant B ids: orders, retailers, products, files, reports, exports, APIs. Verify RLS actually engages; find any query path bypassing the tenant predicate.
* IDOR sweep — iterate sequential and guessable ids on every `GET /:id`

Any cross-tenant leak is P0 and blocks everything after it.

## Phase 13 — Concurrency, idempotency, resilience & error handling

Concurrency — run genuinely in parallel: two sales reps order the last stock; two managers approve the same order; two warehouse users modify inventory; delivery reassignment during delivery; payment submitted twice; two users edit one retailer; order cancellation during picking; product price changed while an order is being created. Look for duplicate records, lost updates, negative inventory, incorrect balances, inconsistent states.
Idempotency — replay every transaction-like operation: create order, submit order, approve order, payment, delivery confirmation, return, inventory adjustment, upload, webhook processing. Retry requests intentionally; the same request twice must produce one effect. Verify idempotency keys exist and are enforced.
Resilience — test failure of backend, database, external APIs, notification services, payment services, storage and network. Determine retries, timeouts, fallback, recovery, queue behaviour, duplicate prevention and data consistency after each. Write `QA/17-resilience-report.md`.
Error handling — intentionally trigger API failure, timeout, network failure, validation error, database failure, authorization failure, expired session, unavailable service, and malformed response. Check whether users receive useful messages. Look for and report: blank screens, generic unexplained errors, stack traces shown to users, frozen buttons, silent failures, duplicate submissions.

## Phase 14 — Offline-first & cross-platform synchronisation

Mandatory for mobile. Simulate excellent network, normal network, slow network, intermittent network, network loss, Wi-Fi → mobile data, mobile data → Wi-Fi, extended offline, and reconnection.
Test offline and across those transitions: login, browsing, search, order creation, order submission, payment, GPS, photo upload, delivery confirmation, return, synchronisation.
Most importantly — duplicate prevention:

```
User taps Submit → request starts → network becomes unstable → user taps Submit again
```

Verify only ONE business transaction is created. Repeat for order submit, approval, payment, delivery confirmation, return, inventory adjustment.
Sync conflicts: web edits an order while mobile holds the old version and submits stale data; two users edit simultaneously; backend changes state while the app screen is open; app is offline then reconnects. Verify every platform converges on the same authoritative business state.

## Phase 15 — Mobile platform testing

**iOS — label findings `[IOS]`**
Where supported: iPhone simulator, physical iPhone where available, supported iOS versions. Check safe areas, notch/Dynamic Island, status bar, navigation, keyboard, scrolling, gestures, permissions, camera, photos, location, notifications, microphone if applicable, biometric authentication if applicable, deep and universal links, secure storage, clipboard, app lifecycle, background behaviour.
Do not consider iOS tested merely because the API works.

**Android — label findings `[ANDROID]`**
Where practical: emulator, physical device, multiple screen sizes, multiple Android versions. Check back button, gesture navigation, status and navigation bars, permissions, camera, GPS, storage and file access, notifications, battery-saving behaviour, background restrictions, app lifecycle, deep links, keyboard, screen sizes, low- and mid-range device behaviour.

**Interruption testing — both platforms**
App background, phone lock, phone unlock, incoming call, notification interruption, app kill, OS termination, reopen, rotation, keyboard opening and closing, low battery, low storage where practical.
Do all of these while: creating an order, submitting an order, paying, confirming delivery, uploading a photo, performing an inventory operation. The application must recover safely — no lost and no duplicated transaction.

**Mobile hardware integration**
Camera, GPS, barcode scanner, push notifications, file picker, storage, biometrics, network, deep links. Verify permissions are requested at appropriate times. Test permission denial. Test permission revocation after previously granting access.
Simulator/emulator results are valid but must be labelled as such. Device-only concerns (real GPS drift, real push delivery, battery) are `NOT TESTED` without a physical device.

## Phase 16 — Security & file security

Input security: SQL injection, XSS (stored and reflected), malformed JSON, oversized input, unexpected types, path traversal, malicious filenames, dangerous file types, unicode tricks in product and retailer names.
API security: authentication, authorization, rate limiting, sensitive endpoints, error leakage (stack traces, SQL, internal paths), CORS, security headers, secrets in responses.
Mobile security: secure token storage (Keychain/Keystore vs SharedPreferences/ AsyncStorage), local data exposure, cached sensitive data, logout cleanup, deep links, embedded secrets, API keys in the bundle, screenshots of screens showing financial information in the app switcher.
File & document security — invoices, retailer documents, product images, delivery proof, payment proof: unsupported extensions, oversized files, malicious filenames, unauthorized access, direct URL access, deleted files, private files, cross-user and cross-tenant access, signed-URL expiry. Verify files cannot be accessed simply by guessing URLs or IDs.
Write `QA/16-security-report.md`.

## Phase 17 — Performance, database, search & pagination

Frontend: initial load, login, dashboard, large lists, search, filtering, navigation, image loading, memory usage.
Mobile: startup time, screen transitions, scrolling a 5,000-row list, memory, battery impact, large lists, slow devices.
Backend: concurrent requests, high traffic, large datasets, slow queries, connection pool, CPU, memory, response times. Test normal load, load, stress, spike, and soak/endurance with k6 or equivalent.
Database: inspect indexes, slow queries, N+1 queries, unnecessary joins, missing pagination, unbounded queries, large aggregations, connection management, transactions, locking. Verify RLS predicates are index-supported, not sequential scans. Test at realistic volumes — seed to 100k orders, 1M ledger rows, 5k retailers. Do not assume a query that works with 20 records works at 10,000 / 100,000 / 1,000,000+.
Search, filter & pagination correctness: empty results, one result, many results, duplicate results, sorting, individual filters, combined filters, pagination, page size, last page, deleted records, stale records, large datasets. Verify no records disappear or duplicate unexpectedly across pages.
Write `QA/15-performance-report.md`.

## Phase 18 — Notifications, audit, observability, DevOps & compatibility

Notifications & escalations — every supported channel (push, in-app, email, SMS, WhatsApp, other integrations) × every event (order created, approval required, order approved, order rejected, delivery assigned, delivery delayed, payment received, outstanding reminder, low stock, failed delivery, return, important escalation) × app foreground / background / terminated. Test notification tap and deep-link behaviour. Check for duplicate notifications.
Audit logging — determine which sensitive actions are audited; at minimum investigate login, logout, user creation, role change, permission change, order creation, order modification, approval, cancellation, inventory adjustment, price change, payment, refund, return, retailer credit changes, configuration changes. Verify records include actor, timestamp, action, target, and before/after where appropriate.
Observability — application logs, API logs, database monitoring, error tracking, performance monitoring, alerts, health checks, metrics, audit logs. Answer concretely: "If production breaks at 2 AM, can the team determine what happened?" Write `QA/20-observability-report.md`.
DevOps & production readiness — environment configuration, secrets, CI/CD, migrations, rollback, deployment, health checks, logging, environment separation, staging, production configuration, dependency management, versioning, database migrations. Write `QA/21-devops-production-readiness.md`.
Backup & disaster recovery — backup strategy, database backup, file backup, recovery process, restore testing, RPO, RTO. Do not simply document that backups exist; determine whether restoration is actually possible. Write `QA/19-backup-disaster-recovery.md`.
API contract testing — request schema, response schema, status codes, authentication, authorization, validation, error format, pagination, backward compatibility. Ensure frontend assumptions match backend behaviour.
App version compatibility — old mobile app + new backend, and new mobile app + existing backend, where practical. Check API versioning, breaking changes, migration, forced update, minimum supported version, stale app behaviour.

## Phase 19 — Date/time, localization, data migration, import & export

Date, time & localization: timezone handling, date formatting, month boundaries, year boundaries, midnight, daylight-saving assumptions where relevant, UTC/local conversion, timestamps, scheduled tasks, expiry dates. The primary target is India — verify appropriate Indian date/time and ₹ currency behaviour throughout.
Data import & export, if supported: CSV import, Excel import, bulk product upload, bulk retailer upload, employee import, export, report download. Test invalid rows, duplicates, missing fields, huge files, partial failures, rollback, encoding.
Data migration: verify migrations run forward and backward on populated data, and that a mid-migration failure leaves a recoverable state. Write `QA/22-data-migration.md`.

## Phase 20 — Web, responsive, accessibility & compatibility

**Web — label findings `[WEB]`**
Browsers: Chrome, Safari, Firefox, Edge. Devices: desktop, laptop, tablet, mobile viewport. Check responsive layout, forms, tables, pagination, filters, search, modals, file uploads, downloads, printing if supported, keyboard navigation, browser back/forward, refresh mid-flow, multiple tabs, session expiry in a background tab, network interruption.

**Responsive UI**
Very small screens, normal mobile, large mobile, tablet, laptop, desktop. Look for clipped content, overlapping elements, unusable buttons, horizontal scrolling, broken tables, inaccessible menus, broken modals, keyboard covering fields, incorrect spacing, unreadable text, incorrect orientation behaviour.

**Accessibility → `QA/23-accessibility-review.md`**
Readable text, contrast, text scaling, keyboard navigation, focus states, labels, touch target size, screen reader support where practical, error messages, forms, navigation.

**Compatibility matrix → `QA/24-compatibility-review.md`**
Rows: Authentication, Orders, Inventory, Payments, Delivery, Notifications, Reports, Files. Columns: Web, iOS, Android, Backend, Database. Statuses: `PASS` / `FAIL` / `PARTIAL` / `NOT SUPPORTED` / `NOT TESTED` / `BLOCKED`.

**Master test matrix → `QA/27-test-matrix.md`**
Rows: every feature. Columns: Owner, Manager, Warehouse, Delivery, Sales, Retailer, Admin, Web, iOS, Android, API, DB. Same status vocabulary.

## Phase 21 — Seven-day real business simulation

Create and run a realistic seven-day simulated distribution operation against the running system.

* Day 1 — onboard retailers, add inventory, configure products/prices/schemes, create employees
* Day 2 — sales reps create orders, manager approves, warehouse processes
* Day 3 — deliveries, payments, outstanding updates
* Day 4 — new stock received, a price change, a scheme introduced
* Day 5 — returns, damaged goods, failed delivery, partial payment
* Day 6 — high-volume orders, concurrent operations, network failures
* Day 7 — reconciliation, reports, outstanding, inventory, revenue, operational review

At the end, answer with numbers: "Would the business numbers reconcile?" Opening stock + receipts − sales − damage − returns = closing stock, per SKU per batch. Revenue = payments + outstanding. Any drift is P0.
Write `QA/25-seven-day-business-simulation.md`.

## Phase 22 — Final audit (only after I say "I am satisfied.")

Run: full regression (all critical automated and manual workflows) · full business simulation (complete realistic distributor operation) · performance test at realistic production-scale load · security test (authentication, authorization, tenant isolation, API and file security) · data consistency audit (orders, inventory, payments, outstanding, reports, database) · platform audit (Web, iOS, Android, backend, database, cross-platform) · production audit (deployment, monitoring, logging, backups, recovery, secrets, configuration, migrations, rollback).
Then write `QA/FINAL-PRODUCTION-READINESS.md`:

1. Executive summary — `PRODUCTION READY` / `PRODUCTION READY WITH KNOWN LIMITATIONS` / `NOT PRODUCTION READY`
2. Business readiness — Owner, Manager, Warehouse, Delivery, Sales Rep, Retailer, Admin
3. Platform readiness — Web, iOS, Android
4. Technical readiness — Backend, Database, API, Performance, Security, Reliability
5. Business integrity — Orders, Inventory, Payments, Outstanding, Returns, Reports
6. Remaining known issues — genuinely unresolved only
7. Known limitations — clearly distinguished from bugs
8. Test coverage — automated tests, integration tests, E2E tests, manual tests, platform tests, performance tests, security tests, business simulations
9. Final recommendation — state clearly whether a real FMCG distributor should deploy this, and what would break first if they did
