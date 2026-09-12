# Findings — Phase 1, Admin walkthrough (dos.admin / dos.support, admin app :5179, admin-service :3007)

Environment: local dev, database `dos_qa` (realistic seed 2026-09-12), all eight services + worker via `QA/tools/start-services.sh`,
web through `QA/tools/pw-server.mjs` + `pw.mjs` (headless Chromium, 1280×800 desk and 390×844 phone), Android debug APK on the
Pixel 7 emulator (API 36, API over `adb reverse`), iOS via Expo Go on the iPhone 16 Pro simulator (Appium) for sign-in and home.
Evidence root: `QA/evidence/phase1/admin/` (`ad-NN` = desk web PNG + innerText `.txt`, `p-NN` = phone width, `ow-NN` = the owner app,
`api-NN-*.json` = one API reply each, `api-probes-NN-*.txt` = a probe run with status codes, `db-NN-*` = SQL output,
`log-01` = admin-service stack, `android/a-NN` = device screenshots, `../phase0/ios/admin-dos.admin-*.png` = simulator).

Walked on Saturday 12 Sep 2026 as Rohit Nair (`dos.admin`, level `super`) and, through the API, as Anita Rao (`dos.support`, level
`support`) — the two console accounts in `platform_admins`. Console tokens come from `POST /auth/platform/login`; a console account
is refused at `/auth/login` and a tenant owner at the platform endpoint, both with a sentence (api-probes-00 in the review).
Actions taken during the walk, all in `dos_qa`: a fourth distributorship **QA Probe Support Pvt Ltd** (`qa-probe-support`, owner
`qa.probe.owner`, must change password) was onboarded by the SUPPORT account; it was suspended and reactivated twice (UI as dos.admin,
API as dos.support); its owner was locked by dos.support; Sai Distributors' subscription was set to Pro / Active / ₹0.01 by
dos.support and restored to Standard / On trial / ₹1,999 / 10 seats / trial to 1 Oct through the console's own dialog; the seeded
open window on Tarsun (dc9b8792) was read through three times and handed back; a fresh request on Sai (#9001) was asked from the
console, approved by Sai's owner through the API for 2 h, read through once and handed back; **dos.admin himself was locked out by
dos.support** and restored by SQL along with `qa.probe.owner` (test-database fixture repair, A.6).

---

### DOS-106 — The "support" console level has every power of the "super" level, including locking the super out
Category: security | Priority: P0 | Role: Admin (support level) | Platform: API (the console UI offers the same buttons to both)

```
User: Anita Rao, dos.support — platform_admins.role = 'support' (Rohit Nair, dos.admin, is 'super')
Platform: API on :3007 with a dos.support token from POST /auth/platform/login; console UI shows both accounts as "Distribution OS staff"
Environment: local dev, dos_qa
Steps:
  1. POST /admin/subscriptions for Sai Distributors {plan: pro, status: active, amountPaise: 1} → 200; the subscription and
     tenants.plan changed (api-probes-02, db-03).
  2. POST /admin/tenants (onboard "QA Probe Support Pvt Ltd" with an owner login) → 200; a fourth distributorship exists with a
     working owner login (api-24, db-03).
  3. POST /admin/tenants/{qa-probe}/suspend → 200, tenants.status = suspended; its owner's sign-in → 423 (api-32, api-30).
  4. POST /admin/users/{qa.probe.owner}/disable → 200, users.status = disabled, 0 open sessions, sign-in → 403 (api-34, api-35).
  5. POST /admin/users/{dos.admin}/disable → 200: the SUPER account is disabled, its three sessions (web, Android, iOS) revoked,
     and dos.admin's next sign-in answers 403 "This account is disabled or has no active membership" (api-45, api-probes-14).
  6. The console's Account screen shows "Level: Distribution OS staff" for both accounts (ad-09, a-08); the platform login reply
     carries role 'platform_admin' for both (tokens in the review). Nothing anywhere distinguishes the two levels.
Expected: The level column exists and the seed describes the two jobs (docs/18: super onboards, sets plans, suspends; support
  ASKS for access). A support account must not create tenants, set what a distributor pays, stop a distributor's whole
  business by suspension, or lock any identity — least of all the super's.
Actual: Every one of the 16 console procedures is open to both levels. A support staffer can silently reprice a customer to
  ₹0.01, suspend a live distributor (every one of its 21 staff and 62 shops refused at sign-in), lock any user out of every
  distributor, and remove the only super. There is no undo for the lock (DOS-107) and the audit trail does not say who did it (DOS-109).
Business impact: One compromised or careless support login = the whole platform. Unauthorised access in the charter's P0 sense.
Severity: P0
Evidence: QA/evidence/phase1/admin/api-probes-02-support-level.txt, api-probes-06-support-suspend-disable.txt,
  api-probes-14-support-locks-super.txt, db-03-after-support-probes.txt, ad-09-settings.png, api-45-support-locks-super.json
Suggested fix: Enforce `platform_admins.role` server-side: `support` = read + `support.request/revoke` only; `super` = everything;
  a super may never disable the last active super. Put the level in the token (or look it up per call) and in the Account screen;
  hide the buttons the level cannot use. Add the level × procedure matrix to `describePermissionMatrix`.
```

### DOS-107 — "Lock this login" has no undo anywhere in the product
Category: missing-feature | Priority: P1 | Role: Admin | Platform: Web + Android (API is the same)

```
User: Admin (dos.admin / dos.support)
Platform: Web desk (People › person panel › "Lock this login"), Android (a-13), API POST /admin/users/{id}/disable
Environment: local dev, dos_qa
Steps:
  1. People → search → open a person → the panel offers exactly one action, "Lock this login" (ad-23, a-13).
  2. API: disable qa.probe.owner → 200; DB users.status = 'disabled', all sessions revoked, sign-in → 403 (api-34, api-35).
  3. Look for the way back: the admin README has 16 endpoints and none enables/unlocks/reinstates; grep of every service README
     for enable|unlock|reinstate|restore finds only tenants/{id}/reactivate and the owner's /tenancy/staff/set-status, which
     is a MEMBERSHIP status, not the global users.status the lock sets (api-probes-06 tail, README grep in the review).
  4. The People screen's "Locked out" filter lists the locked identity (ad-21) with no button on it.
  5. Both dos.admin and qa.probe.owner had to be restored with SQL.
Expected: A lock is a mistake-prone, high-impact action (it spans every distributor the person belongs to); it needs a
  reversible counterpart, audited the same way, and a confirmation that names the distributorships affected.
Actual: One tap locks a person out of every distributor for ever; the only remedy is a database update.
Business impact: A wrong tap on a distributor's owner (52 people share a phone-number-searchable list) ends that business's
  access until an engineer runs SQL; combined with DOS-106 the platform's own super can be removed.
Severity: P1
Evidence: QA/evidence/phase1/admin/ad-23-person-sunil.png, ad-21-people-locked.png, android/a-13-person-panel.png,
  api-probes-06-support-suspend-disable.txt, api-probes-14-support-locks-super.txt
Suggested fix: `admin.users.enable` (super only, audited "Login unlocked"), an "Unlock this login" button on the Locked-out row,
  and a confirm dialog on lock that lists the memberships and asks for a reason (the API already takes one).
```

### DOS-108 — The owner app never shows the "Support access" tab, so no owner can approve or refuse a support request
Category: bug | Priority: P1 | Role: Owner (the other half of the Admin flow) | Platform: Web desk + phone

```
User: Owner (sunil.tarsun) with three support requests on file (one requested, one approved-then-revoked, one expired)
Platform: Web 1280×800 and 390×844, owner app :5173, Settings
Environment: local dev, dos_qa
Steps:
  1. Console → Sai detail → "Ask for support access" → the console says "Sai Distributors is waiting for their owner to answer,
     in their own app" (ad-29).
  2. Owner app → Settings. Tabs rendered: Business profile · Numbering series · Feature flags (and Imports · Messages · Audit)
     at desk (ow-01) and phone (ow-03). No "Support access".
  3. DOM search for any element whose text contains "support" at both widths: none (api-probes output in the review §4).
  4. The strings file has 'o24.support': 'Support access' and the Settings view list includes { id: 'support' }, i.e. the
     screen exists but is never reachable.
  5. The API half works: Sai's owner approved request 01a095f1 for 2 h through POST /tenancy/support-grants/{id}/approve →
     200, and the console then showed "Open now · 1 h 47 min" (api-42, ad-36).
Expected: The owner opens Settings › Support access, reads the reason "word for word" (as the console promises), and approves
  for the hours asked or fewer, or refuses.
Actual: The request sits in "Waiting for their owner" for ever (the console then calls it "Lapsed, no answer" — DOS-110);
  support can only be granted by someone with curl.
Business impact: The founder's support model (console asks, owner approves) cannot run at all for a real distributor.
Severity: P1
Evidence: QA/evidence/phase1/admin/ow-01-settings.png/.txt, ow-03-settings-phone.png/.txt, ad-29-asked.png, api-42-saiowner-approve.json
Suggested fix: Render the fourth Settings view (the segmented control shows three); give it the request card with reason, hours
  asked, requester, "Approve for N h" (capped at the ask) and "Refuse"; badge Settings when a request is waiting.
```

### DOS-109 — The audit trail cannot say WHO did anything: every row reads "Distribution OS staff"
Category: security | Priority: P1 | Role: Admin | Platform: Web + Android

```
User: Admin (dos.admin) reading Audit trail after a day in which two different staff acted
Platform: Web desk (ad-19, ad-35), Android (a-07)
Environment: local dev, dos_qa
Steps:
  1. Actions were taken by two accounts: dos.support (subscription changed, tenant onboarded, suspended, login locked) and
     dos.admin (suspended, reactivated, support asked, three reads, window withdrawn). platform_audit.admin_user_id holds the
     right user for each (db-04, db-03).
  2. Audit trail screen: 16 rows, columns When · Distributorship · Who · On. "Who" = "Distribution OS staff" on every row.
  3. No row shows the reason typed into the suspend dialog ("Why (goes into the audit trail)"), the old/new plan, or the route
     read; the payload has all of it. No filter by distributorship, action or person — only 30/60/90 days.
  4. The distributor detail's window panel names the requester "Distribution OS support" while the Support list names
     "Rohit Nair (Distribution OS)" for the same grant (api-probes-09 vs ad-06).
Expected: An audit trail names the actor, shows the reason and the before/after, and can be filtered — it is the only control
  on the actions in DOS-106.
Actual: The trail proves that "someone on staff" did something to a tenant at a time. Nothing more.
Business impact: After a wrong suspension or a ₹0.01 plan nobody can tell which staffer did it from the product.
Severity: P1
Evidence: QA/evidence/phase1/admin/ad-19-audit.png, ad-35-audit-final.png/.txt, android/a-07-audit.png, db-04-audit-after-suspend.txt
Suggested fix: Show admin name (join users), the reason and a one-line before→after from the payload; add filters for
  distributorship, action and staff member; make the row expandable to the raw payload.
```

### DOS-110 — A request the console calls "Lapsed" is still "requested" to the owner's service, and approving it fails
Category: business-logic | Priority: P2 | Role: Admin + Owner | Platform: Web (console) + API (owner-service)

```
User: dos.support asked Tarsun, Sai and Kalyan for 4 h at 12:50; nobody answered
Platform: Console web + API on :3007 and :3001
Environment: local dev, dos_qa
Steps:
  1. 19:20: console home says "0 support requests waiting for an owner"; Support › Waiting shows "Nobody's owner is being waited
     on" (ad-01, ad-11). Support › All shows the three as "Lapsed, no answer" (ad-12b).
  2. DB: approved_at is null on all three; there is no lapsed status; expires_at = requested_at + 4 h (db-01).
  3. GET /admin/support-grants?status=requested (console API) → the same three, status "requested" (api-06b).
  4. GET /tenancy/support-grants (owner API, sunil) → 7232298a status "requested", expiresAt null, active false (api-01).
  5. Owner approves 7232298a for 2 h → 409 "that window has already closed; ask the console to raise a new request"
     (api-probes-04). Approving for 72 h → 400 "may be shortened, never lengthened" (correct).
  6. A fresh request (#9001) showed in Waiting and the home tile at once (ad-30), so the rule is time-based: a request that
     is not answered within the hours asked disappears from the console's counts but never from the owner's list.
Expected: One status, agreed by both services; the console shows lapsed requests as needing a re-ask, the owner's list
  marks them lapsed, and nobody is offered an Approve that cannot succeed.
Actual: The console under-counts what is waiting; the owner's service lists a request it will refuse; the DB cannot tell.
Business impact: Support waits for an answer the owner is never told is too late; when DOS-108 is fixed, owners will hit 409s.
Severity: P2
Evidence: QA/evidence/phase1/admin/ad-11-support-waiting.png, ad-12b-support-all.png, db-01-support-requests.txt,
  api-06b-admin-support-requested.json, api-01-owner-support-requested.json, api-probes-04-owner-approve-bodyid.txt
Suggested fix: Compute a `lapsed` status in the shared list query (requested_at + requested_hours < now, approved_at null)
  and return it from both services; the console's "Lapsed" tab; the owner's list shows it greyed with "Ask them to raise it again".
```

### DOS-111 — The distributor never learns what support read under the window it approved
Category: security | Priority: P2 | Role: Owner (approver) | Platform: Web + API

```
User: Sunil Tarsun, who approved a 72-hour read-only window for ticket #4207
Platform: owner app :5173 Settings › Audit; API; DB
Environment: local dev, dos_qa
Steps:
  1. Under the window, the console read GET /retailers, GET /tenant-catalog/costs (purchase costs) and
     GET /receivables/outstanding (every shop's dues) — 200 each — then the console UI's "Open the window" read the
     branding and numbering series (api-probes-08, ad-31).
  2. Console: "What we have read under this window" lists the three routes; platform_audit has a support.read row per call.
  3. Tenant side: audit_log has 8 rows for Tarsun today, none for the reads (db-05); the owner's Settings › Audit shows
     set-credit, exports and GPS reads, nothing from support (ow-02); GET /tenancy/support-grants carries no read count.
Expected: "Audited" cuts both ways: the owner who opened the window sees what was read through it, at least the routes and times.
Actual: Only Distribution OS can see what Distribution OS read. The owner's own audit page — which does record GPS "live map
  reads" by its own staff — is silent about an outsider reading its purchase costs.
Business impact: Trust: the pass legitimately reads cost and money data; the distributor cannot verify support stayed on-ticket.
Severity: P2
Evidence: QA/evidence/phase1/admin/db-05-tenant-audit-support-reads.txt, ow-02-settings-audit.png, api-probes-08-support-pass.txt,
  ad-31-open-window.png
Suggested fix: Write a tenant audit_log row (actor_role support, action support.read, the route) per pass call — same
  interceptor, second insert — and show them under the grant in the owner's Support access view.
```

### DOS-112 — Per-record mutations ignore the `{id}` in the path and act on the body `id`, which the docs call the mutation id
Category: tech-debt | Priority: P2 | Role: Admin + Owner (API) | Platform: API (:3007 and :3001)

```
User: any API client following the generated README ("ids are client-generated UUIDv7, every write carries an idempotencyKey")
Platform: API
Environment: local dev, dos_qa
Steps:
  1. POST /admin/tenants/{kalyan}/suspend with a fresh body id → 500 Internal server error; the log shows the idempotency row
     being written with tenant_id = the BODY id and failing the FK to tenants (log-01, api-probes-02).
  2. POST /admin/users/{sameer}/disable with a fresh body id → 404 "no user <body id>" (api-25).
  3. POST /tenancy/support-grants/{7232298a}/approve with a fresh body id → 404 "support request <body id> not found" (api-26).
  4. Path = random UUID, body id = the real grant → 409 request_expired, i.e. it found and acted on the body's record; the path
     was never consulted (api-probes-05).
  5. With body id = path id every call works (api-32, api-33, api-34, api-28).
Expected: The path identifies the record; the body `id` is the mutation id as documented (or the contract says clearly that
  `id` IS the target and the path is decorative — and then the two must be checked for equality).
Actual: The path is ignored. A client that sends the documented shape gets 500/404; one that sends the wrong body id acts on
  another record while the URL says otherwise.
Business impact: Any integration or second client (the founder wants seven apps plus imports) hits this on every per-record
  action; a 500 on suspend hides a plain input error.
Severity: P2
Evidence: QA/evidence/phase1/admin/log-01-admin-service-suspend-500.txt, api-probes-02-support-level.txt,
  api-probes-03-owner-approve.txt, api-probes-05-path-vs-body.txt
Suggested fix: Read the target from the path param in these handlers; if the contract keeps `id` as the target, reject a
  mismatch with 400 and fix the README hint. Affects at least suspend, reactivate, users.disable, support.revoke on :3007 and
  support.approve/revoke on :3001 (others not probed).
```

### DOS-113 — Every distributor shows two different plans: the tenant's and the subscription's
Category: ux | Priority: P3 | Role: Admin | Platform: Web + Android

```
User: Admin reading the Distributors list, a detail page and the home chart
Platform: Web desk (ad-02, ad-03, ad-01), Android (a-03)
Environment: local dev, dos_qa
Steps:
  1. Distributors list: Tarsun "Plan: Pilot"; Subscriptions list: Tarsun "Pro" (ad-02, ad-05).
  2. Tarsun detail: header chip "Pilot", Subscription block "Plan: Pro" (ad-03). Kalyan: chip "Growth", subscription "Standard".
  3. Home "Distributorships by plan": Pilot 1 · Starter 1 · Growth 1, while "Subscriptions by state" counts the same three.
  4. DB: tenants.plan and subscriptions.plan are two columns; the seed wrote different values. Saving a plan from the console
     dialog writes both (Sai: starter→pro→standard on both, db-03 and the restore).
Expected: One plan per distributor, shown once.
Actual: Two columns, both displayed, disagreeing for two of three seeded distributors; the list's plan filter (Pilot…Pro)
  filters on the tenant column.
Business impact: Low; confusing when it disagrees, and a seed-data smell (founder: no more seed work — file only).
Severity: P3
Evidence: QA/evidence/phase1/admin/ad-02-distributors.png, ad-03-distributors-01a0947d-7a.png, ad-05-subscriptions.png, db-03-after-support-probes.txt
Suggested fix: Show only the subscription's plan (or derive tenants.plan from it); fix the two seeded rows when seed work resumes.
```

### DOS-114 — Console polish: a 400 after hand-back, "1 support requests", an unsorted People list, no plan action on Subscriptions
Category: ux | Priority: P3 | Role: Admin | Platform: Web

```
User: Admin
Platform: Web desk
Environment: local dev, dos_qa
Steps:
  1. Tarsun detail → "Hand the window back" → confirm → the page fires GET /admin/audit?tenantId=…&action=support.read
     &entityType=support&entityId=&limit=20 → 400 (console error; nothing visible breaks) (api-probes-12 tail).
  2. Home tile after one ask: "1 support requests waiting for an owner" (ad-30 turn, a-01).
  3. People: 52 rows in database order (sandeep.mane, pilot.owner, anita.sonawane…); search works, sorting does not exist (ad-07).
  4. Subscriptions is a read-only list: to change a plan you must go Distributors → detail → "Change the plan" (ad-05 refs).
  5. Support › "All" label is easy to hit wrongly with an exact-text tool but fine by mouse (ad-12 vs ad-12b) — not a defect.
Expected: No failed requests after a successful action; plural agreement; a sorted directory; a row action where the data is.
Actual: As above.
Business impact: Cosmetic.
Severity: P3
Evidence: QA/evidence/phase1/admin/api-probes-12-handback.txt, ad-07-users.png, ad-05-subscriptions.png, android/a-01-home.png
Suggested fix: Skip the reads query when the window is closed; "1 support request"; sort People by name with a "recently
  signed in" option; a "Change" link per Subscriptions row.
```

---

## Earlier findings confirmed again here

- DOS-028 (manager audit) and the owner's own audit page: the owner's Settings › Audit does record set-credit, exports and GPS
  reads (ow-02) — the gap is the support reads (DOS-111), not the page.

## Worked as intended (recorded so nobody re-tests it)

- Sign-in boundaries: console account at `/auth/login` → 403 "Sign in at POST /auth/platform/login"; owner at the platform
  endpoint → 403; owner token on :3007 → 403 "does not serve the owner role"; console token on :3001/:3003/:3006 → 403;
  no token → 401 (api-probes-01).
- Suspension: UI dialog with reason → tenants.status suspended → the owner's sign-in answers 423 with the distributor's name and
  a contact address → reactivate with a note → sign-in 200 with mustChangePassword (ad-16…ad-18, api-30, api-31).
- The support pass: mint only on an approved, unexpired, un-revoked window that is yours (403 with a sentence otherwise); 5-minute
  life; reads 200; any write 403 "the distributor approved a look, not a change"; refused on sales/manager/admin services; refused
  with another account's token; tenant-bound (Sai's pass returns Sai's shops); dies with hand-back; one support.read audit row per
  call; "What we have read" lists the routes (api-probes-08, -12, -13, ad-31, ad-33).
- Owner guard: approving for more hours than asked → 400 "may be shortened, never lengthened" (api-probes-04).
- Subscription upsert: same key + same payload replays; same key + different payload → 409; negative amount / zero seats → 400
  with field paths; period end before start → 400 with a sentence (api-probes-07). The console's dialog restored Sai exactly.
- Onboarding form: inline validation ("That is not a valid GSTIN", handle rule, phone rule, password rule) and a disabled submit
  until valid (ad-37); the API onboarding created tenant + owner + trial in one call and the owner could sign in (api-24, api-31).
- Password change: revoking other devices is stated on the form (ad-10); not exercised for the console account (the Retailer walk
  covered the same auth module).
