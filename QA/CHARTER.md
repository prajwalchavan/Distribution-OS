# §A — RULES

## A.1 Core principles

**Never assume functionality works**
If something appears implemented, verify it.

* If an API exists, call it.
* If a UI button exists, press it.
* If a database constraint exists, try to violate it.
* If a permission exists, attempt unauthorized access.
* If a notification exists, verify it is actually delivered.
* If an order state exists, test every possible transition.
* If an error handler exists, intentionally trigger the error.
* If a validation exists, submit input that should fail it.

**Test the BUSINESS, not only the software**
Think like a real distributor. A real business does not care that `GET /orders` returns HTTP 200. They care that:
"My salesman created an order, my manager approved it, my warehouse packed the correct products, my delivery person delivered it, my retailer paid ₹X, inventory reduced correctly, outstanding updated correctly, and my reports show the same numbers."
Every major workflow must be validated end-to-end, in those terms.

**All platforms are first-class products**
Test Web, iOS, Android, Backend APIs, Database and cross-platform synchronisation separately.

* Do NOT assume: "It works on Web, therefore it works on mobile."
* Do NOT assume: "The Android flow works, therefore iOS works."
* Do NOT assume: "The backend accepts it, therefore the UI handles it correctly."

**Do not silently change product behaviour**
You may identify bugs, UX problems, missing features, business-logic problems, security problems and performance problems, and propose improvements. You may not implement product changes without approval. See A.6.

## A.2 Environment authority — act without asking

You are authorised to set up whatever you need to actually run and test this system. Do not stop to ask permission for tooling. Install and configure as needed: language runtimes, package managers, project dependencies, Docker services (Postgres, Redis, queues), Playwright + browsers, Maestro or Detox for mobile E2E, k6 or autocannon for load, `adb`, `xcrun simctl`, Android emulator images, iOS simulators, migration tooling, seed tooling, coverage and mutation-testing tools.
Prefer project-local over global. Never alter system config beyond a normal dev setup. Log every install command in `QA/ENV.md` so the setup is reproducible. If an install genuinely cannot succeed, record the blocker there and mark dependent work `BLOCKED` — never fake it. Stop and ask only for anything that costs money, touches a cloud account, or needs a paid developer account.

## A.3 Test data only — never production

Local/test database and test tenants only. Never read, write, seed over, or point anything at Tarsun Enterprises data or any real distributor, retailer or invoice data. If you find real data in a dev database, stop and tell me before touching it. Destructive operations (drop, truncate, reset) only against a database whose name you have verified contains `test` or `dev`. All fixtures are realistic but fictional.

## A.4 The evidence rule

Never report a result for something you did not actually execute.
Every observation must cite one of: a command you ran with its output; a screenshot path (Playwright / simctl / adb screencap); a database query and its result; an HTTP request/response pair; a test file and its run output.
In Stage 1 especially, you are claiming to have used the app — a screenshot per screen you report on is the proof. If you could not run something (no emulator, feature not built, blocked by an earlier bug), the status is `NOT TESTED` or `BLOCKED` with a one-line reason. That is an acceptable answer and I much prefer it to a guess.
Never infer a mobile result from an API result. Never infer iOS from Android. Never write "should work" as a status.

**Evidence format for every important finding**

```
User: Sales Rep
Platform: Android (Pixel 6 emulator, API 34)
Environment: local dev, seed v3
Steps:
  1. …
  2. …
  3. …
Expected: …
Actual: …
Business impact: …
Severity: P1
Evidence: QA/evidence/dos-042-order-screen.png
Suggested fix: …
```

Never write vague findings such as "the order system has some issues." Be precise.

## A.5 Do not game the tests

Forbidden: weakening tests to make them pass, removing failing tests, mocking away important business behaviour, bypassing validation, modifying expected values because the implementation is wrong, hiding errors, classifying real failures as "expected", marking untested functionality as PASS.
If something cannot be tested, mark it `NOT TESTED` and explain why. If a test fails because the product is wrong, the product is wrong — log it.

## A.6 Change discipline

You may fix automatically: broken tests, test infrastructure problems, fixtures, seed scripts, CI config, clearly accidental test-environment issues, your own test code.
You may not change product behaviour — logic, schema, UI, API contracts — without my explicit approval for that specific batch. When approval is needed, end the turn with the request and stop. Never ask and then continue in the same message.
Approval vocabulary:

* "Continue" → keep testing and documenting, no product changes
* "Fix P0/P1" → implement only that priority scope
* "Implement all approved" → implement everything explicitly approved
* "the product is right" → close Stage 1, begin Stage 2
* "I am satisfied." → run the final audit

## A.7 Finding format & categories

Findings go in `QA/findings/<NN>-<slug>.md`, one block each, using the A.4 evidence format plus a header line:

```
### DOS-042 — Sales rep cannot see retailer outstanding while ordering
Category: missing-feature | Priority: P1 | Role: Sales Rep | Platform: Android
```

Categories are exclusive — do not mix them:

* `bug` — something that should work but does not
* `ux` — it works but is difficult or confusing
* `business-logic` — the software produces an incorrect business outcome
* `missing-feature` — a necessary capability does not exist
* `security` — unauthorised access or unsafe behaviour
* `performance` — becomes slow or unusable under realistic conditions
* `reliability` — fails or behaves unpredictably
* `tech-debt` — implementation problems that increase future risk

Priorities:

* P0 — Critical: financial corruption, data loss, unauthorised access, tenant data leakage, duplicate payment, incorrect inventory with serious business impact, a critical workflow that is impossible, a security vulnerability
* P1 — High: major operational issue affecting normal business
* P2 — Medium: important, but a workaround exists
* P3 — Low: minor UX or cosmetic

Always work P0 → P1 → P2 → P3. Never spend significant time polishing P3 while P0 or P1 remain open.

## A.8 Token discipline

I am on Claude Max 20x. Do not waste tokens repeatedly reading the entire repository. Use targeted searches, summaries, test scripts, reusable fixtures, automation, the QA documentation, and incremental analysis.

* Delegate every broad codebase sweep to a subagent — verbose output stays in its context, only the summary returns.
* Targeted greps and globs; never a full repo walk.
* Do not dump large logs, full test output or file contents into chat. Store detailed evidence in `QA/` files and cite the path.
* One phase per session.

## A.9 Chat reporting format

Do not send me long explanations during execution. Updates look exactly like this:

```
Phase 1 — Real-user walkthrough (Sales Rep)
Completed:
  ✓ retailer discovery, product search, order build
  ✓ scheme + credit visibility, submission, history
Found: P0:0  P1:3  P2:5  P3:2
Detail: QA/findings/01-walkthrough-sales-rep.md
Next: Warehouse role on Android
```

At an approval gate:

```
APPROVAL REQUIRED
P0: 1 (DOS-011 invoice total excludes scheme discount)
P1: 4 (DOS-042, DOS-045, DOS-051, DOS-053)
Recommend this batch of 5 before continuing —
DOS-011 makes every downstream number wrong.
Approve?
```

Then stop.

## A.10 QA directory — the project's long-term QA memory

Create each file when you first reach the phase that needs it, not all upfront. Update incrementally; never recreate from scratch.

```
QA/
├── CHARTER.md                        (this file)
├── PHASES.md
├── STATE.md
├── ENV.md                            reproducible setup + install log
├── 00-system-understanding.md        architecture as implemented
├── 01-test-strategy.md
├── 02-owner-review.md
├── 03-manager-review.md
├── 04-warehouse-review.md
├── 05-delivery-review.md
├── 06-sales-rep-review.md
├── 07-retailer-review.md
├── 08-admin-review.md
├── 09-cross-role-workflows.md
├── 10-business-logic-audit.md
├── 11-missing-features.md
├── 12-change-backlog.md
├── 13-change-log.md
├── 14-regression-results.md
├── 15-performance-report.md
├── 16-security-report.md
├── 17-resilience-report.md
├── 18-data-consistency-report.md
├── 19-backup-disaster-recovery.md
├── 20-observability-report.md
├── 21-devops-production-readiness.md
├── 22-data-migration.md
├── 23-accessibility-review.md
├── 24-compatibility-review.md
├── 25-seven-day-business-simulation.md
├── 26-test-suite.md                  coverage by layer
├── 27-test-matrix.md                 master feature × role × platform matrix
├── FINAL-PRODUCTION-READINESS.md
├── findings/                         per-phase finding blocks
├── evidence/                         screenshots, logs, payloads, query output
└── tools/                            seed, reconcile, generators, load scripts
```

## A.11 Session state — the resumption contract

`QA/STATE.md` holds this and nothing else:

```
Stage: 1
Current phase: 1 — Real-user walkthrough
Status: in progress | awaiting approval | complete
Roles walked: Owner, Manager, Sales Rep
Roles remaining: Warehouse, Delivery, Retailer, Admin
Completed phases: 0
Open P0: DOS-011
Open P1: DOS-042, DOS-045, DOS-051, DOS-053
Approved & unimplemented: none
Blocked: iOS — simulator only, no physical device
Next action: walk Warehouse role on Android emulator
Last updated: <date>
```

Update it before ending any turn that changes it. Read it first in every session and resume from `Next action`.

## A.12 Regression standard

After every approved change batch, run all five and log to `QA/14-regression-results.md`:

1. Focused regression — the functionality directly changed
2. Cross-role regression — the workflows that touch it (Phase 2 chain)
3. Platform regression — Web, iOS, Android
4. Business regression — orders, inventory, payments, outstanding, delivery, reports still reconcile
5. Security regression — permissions and isolation were not weakened

## A.13 Automation standard

Whenever practical, automate repetitive testing. Build and reuse: seed scripts, test fixtures, API tests, integration tests, E2E tests, performance scripts, data generators, reconciliation scripts, DB snapshot/restore helpers.
Do not manually repeat something that can reliably be automated. However, automation does not replace real-user testing — Stage 1 is done by hand, on the running apps.

## A.14 Git safety

Create a checkpoint commit before any approved product change. Do not destroy working functionality while experimenting. Keep changes traceable. Never reset, rebase, force-push, or delete work you did not create in this session. Never overwrite unrelated changes. Keep QA docs and product changes in separate commits.

## A.15 Iteration rule

```
TEST → FINDINGS → DOCUMENT → PRIORITIZE → ASK APPROVAL
   → IMPLEMENT APPROVED → REGRESSION → REAL USER TEST → TEST AGAIN
```

Continue this loop. Do not declare the product finished unless I explicitly say "I am satisfied."

## A.16 Production-readiness standard

The product is NOT production-ready merely because unit tests pass, CI passes, builds succeed, APIs return 200, or the UI looks good.
Production-ready means: a real FMCG distributor can operate a city-scale distribution business using Distribution OS without major operational, financial, security, usability, reliability or performance problems.
All of the following must be acceptable: authentication, authorization, role permissions, orders, inventory, pricing, schemes, payments, outstanding, delivery, returns, notifications, reporting, auditability, security, performance, reliability, offline and poor-network behaviour, Web, iOS, Android, cross-platform consistency, data integrity, backup and recovery, observability, deployment.

## A.17 Stage gates

Do not begin Stage 2 until I say "the product is right." Do not run the final audit until I say "I am satisfied."
