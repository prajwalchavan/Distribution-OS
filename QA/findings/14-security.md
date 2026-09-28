# Phase 16 — Security & file security findings (2026-09-28)

Lane: security. Product code UNCHANGED. All attacks were run against a LOCAL production-mode API on
:3620 (database `dos_test_p16_security`, an isolated copy of the batch2b template). The public hosts
(`https://www.distributionos.in`, `https://api.distributionos.in`) were only READ — 14 unauthenticated
GET/HEAD/OPTIONS requests, no credentials, no payloads (`QA/evidence/p16/public-observations.txt`).
Evidence: `QA/evidence/p16/`. Tools: `QA/tools/p16/`.

Ids DOS-290..DOS-297. Findings already recorded in QA/25 §5 are not repeated.

---

### DOS-290 — Production API serves interactive docs + OpenAPI unauthenticated, embedding real customer PII
Category: security | Priority: P0 | Role: all (owner service shown; all 8 services affected) | Platform: API (production, live)
Status: **FIXED and LIVE 2026-09-28 08:35 IST** — main `a3eb5981` (`2bc18716`), founder approved. In production `/docs`, `/docs/openapi.json` and `/swagger` do not exist unless `API_DOCS=on`, and even then the examples never read rows. Checked by the main session: a production-mode build on this Mac answered 404 on all 32 addresses (8 services × 4), sign-in and orders unaffected; after the deploy the public host answers 404 on `/owner/docs`, `/owner/docs/openapi.json`, `?fresh=1`, `/owner/swagger`, `/auth/docs`, `/retailer/docs/openapi.json`, `/admin/swagger`. Exposure window: from go-live (26 Sep) to this deploy; whether anyone fetched the document is not known from here.

User: anonymous (no token)
Platform: API — `https://api.distributionos.in` (production, `NODE_ENV=production`, all-in-one)
Environment: LIVE production, observed 2026-09-28 with 3 unauthenticated GETs
Steps:
  1. GET https://api.distributionos.in/owner/docs        -> 200 text/html (Scalar API reference)
  2. GET https://api.distributionos.in/owner/swagger     -> 200 text/html (Swagger UI, "Try it out" enabled)
  3. GET https://api.distributionos.in/owner/docs/openapi.json -> 200, 1.37 MB
  4. Parse the OpenAPI: its request examples are built from real rows of the live tenant.
Expected: API reference and machine-readable spec are either not served in production, or require
authentication, or use synthetic examples — never the live distributor's real data on the open internet.
Actual: All three are public on every one of the 8 services (`/auth /owner /manager /sales /warehouse
/delivery /retailer /admin` — confirmed served; `/health` lists them all). The owner document alone
embeds real live-tenant data pulled from `dos_live` at generation time: live tenant id
`01a0dc97-…`, 145 distinct real row UUIDs, and real example values for phone, altPhone, GSTIN
(buyer/supplier), a staff username, shop name, owner name, legal name, 11 `name` values, UPI VPA, the
UPI pay link, city, pincode and bank name. The description block still says "every demo user's password
is Dos@1234" (misleading on a live box; see the NOT-TESTED note about placeholder "(test)" staff).
The example generator (`backend/libs/core/src/docs/examples.ts` `pickTenant` → "oldest active tenant
with shops and orders") deliberately reads the real pilot tenant on the live database.
Business impact: the pilot customer's real shop names, phone numbers, GSTINs, a staff login username,
and UPI payment identifier are exposed to any anonymous internet visitor (and to crawlers/indexers).
This is tenant data leakage (charter P0) — a privacy/DPDP-Act and business-confidentiality breach —
and it hands an attacker a real username plus the whole API surface for targeted attacks.
Severity: P0
Evidence: QA/evidence/p16/prod-openapi-disclosure.json (metadata only — real PII values deliberately
NOT recorded), QA/evidence/p16/public-observations.txt (REQ3–REQ5); local mirror
QA/evidence/p16/openapi-*.json; disclosure mechanism in backend/libs/core/src/service/docs.controller.ts
and docs/examples.ts.
Suggested fix: gate `/docs`, `/swagger`, `/docs/openapi.json` behind auth (or disable them) when
`NODE_ENV=production`; if kept, generate examples from a synthetic sampler in production, never from
live rows. Same treatment for the topology in `/health` (see DOS-296).

---

### DOS-291 — File serving is broken in production all-in-one: local-driver URLs are unroutable (404)
Category: bug | Priority: P1 | Role: all (owner/manager/warehouse/delivery/retailer) | Platform: API + Web + Android (production)
Status: **FIXED and LIVE 2026-09-28 08:35 IST** — main `a3eb5981` (`bfda0433`), founder approved. The all-in-one router hands a bare `/storage/…` link to a mounted service. Checked: on a production-mode build with `OBJECT_STORAGE_PUBLIC_URL` set, a file was uploaded to the link exactly as minted and read back byte for byte (70 bytes), a tampered signature got 403; on the public host the bare link with a bad signature now answers 403 "invalid or expired storage link" instead of 404. NOT run: opening a real bill PDF signed in on live (production reads are the founder's).

User: any signed-in user opening a file/PDF/photo
Platform: API all-in-one (production), and both clients (web + APK) which fetch the minted URL
Environment: LIVE production topology; reproduced locally on :3620; confirmed on prod with 1 GET
Steps:
  1. As owner, POST /owner/files/upload-url (domain logo) — the minted url is
     `<OBJECT_STORAGE_PUBLIC_URL>/storage/tenant/…/….png?expires&signature`, i.e. an ABSOLUTE URL
     with NO service prefix (prod sets OBJECT_STORAGE_PUBLIC_URL=https://api.distributionos.in —
     backend/infra/oracle-vm/vm-setup.sh).
  2. Fetch that URL exactly as returned (bare `/storage/…`).
Expected: the bytes are served (or a PUT stores them). The frontend `absoluteUrl(group,url)`
(frontend/dos-app/src/config.ts) returns an already-absolute URL unchanged, so the client fetches the
bare `/storage/…` path as-is.
Actual: the all-in-one front router (backend/libs/core/src/service/all-in-one.ts) only routes paths
that begin with a `/<service>` prefix; `/storage/…` matches none, so it returns
404 {"error":"no service is mounted at this path"}. Reproduced locally: PUT to bare `/storage/…` -> 404,
PUT to `/owner/storage/…` -> 200; and confirmed on production (REQ6):
GET https://api.distributionos.in/storage/tenant/x/logo/y/z.png?… -> 404 "no service is mounted".
The `StorageController` that would serve the file is only reachable under a service prefix
(`/owner/storage/…`), which the minted URL never has.
Business impact: every file feature is broken in production — white-label logo, delivery-proof (POD)
photos, expense proofs, claim evidence, imports, export downloads, and all rendered PDFs (invoice,
credit note, challan, receipt) return 404 on both the website and the Android app. A distributor cannot
open an invoice PDF or view a delivery photo.
Severity: P1 (a whole class of workflows is non-functional in production; no data corruption)
Evidence: QA/evidence/p16/files.json (local put bare=404), QA/evidence/p16/public-observations.txt
(REQ6, prod 404); code: all-in-one.ts matchPrefix, object-storage.ts createLocalStorage (`${base}/storage/…`),
config.ts absoluteUrl, vm-setup.sh line 36.
Suggested fix: mint local-driver URLs with the serving service's prefix (e.g. `/owner/storage/…`), or
add a top-level `/storage` route to the all-in-one front server that dispatches to any service's
StorageController, or have the client re-prefix `/storage` URLs. NOTE: file access CONTROL is sound
(see the tested-PASS list) — this is a routing/serving defect, not an exposure.

---

### DOS-292 — CSV/formula injection: exports do not neutralize leading = + - @
Category: security | Priority: P2 | Role: owner/manager/accountant (exporters); injected by any writer of a free-text field | Platform: API/exports → Excel/LibreOffice

User: attacker sets a free-text field (e.g. shop name, note); victim = whoever opens the export
Platform: any export that runs through `renderCsv` (reporting registers, receivables statements, Tally, incentives)
Environment: local :3620, verified against the shared CSV helper and via live create/read-back
Steps:
  1. As owner, POST /owner/retailers with name `=HYPERLINK("http://evil.example","click")` -> 200; read
     back verbatim (the name is stored exactly, only length-capped at 120; no character class blocks `=`).
  2. Feed formula-leading cells to the platform CSV writer
     (backend/libs/core/src/platform/csv.ts `renderCsv`/`cell`).
Expected: cells beginning with `=`, `+`, `-`, `@`, TAB or CR are neutralized (prefixed with `'`) so a
spreadsheet does not evaluate them.
Actual: `cell()` only quotes cells containing `," \r \n`; it does not neutralize formula leads. Output
observed: `=HYPERLINK(…)` written (quoted only for its commas — Excel still evaluates it), and `+1+1`,
`-2+3`, `@SUM(A1:A9)` written completely unquoted. Opened in Excel/LibreOffice these run as formulas
(=WEBSERVICE/=HYPERLINK data exfiltration, DDE).
Business impact: a retailer/salesperson (or any user who can name a shop or write a note) can plant a
formula that fires when the owner/accountant exports and opens a CSV — data exfiltration or a malicious
link, on the finance operator's machine. Requires the victim to open the file and clear a spreadsheet
warning.
Severity: P2
Evidence: QA/evidence/p16/injection.json (verbatim `=HYPERLINK` stored), renderCsv demonstration in the
Phase-16 run log; code backend/libs/core/src/platform/csv.ts.
Suggested fix: in `cell()`, prefix any string cell whose first character is `= + - @` (or TAB/CR) with a
leading apostrophe, or wrap and escape it per OWASP CSV-injection guidance.

---

### DOS-293 — Unauthenticated DoS amplification via /{service}/docs/openapi.json?fresh=1
Category: performance | Priority: P2 | Role: anonymous | Platform: API (all-in-one, single VM)
Status: **FIXED and LIVE 2026-09-28 08:35 IST** with DOS-290 (`2bc18716`): the route does not exist in production, and `fresh` is ignored there if the reference is ever switched on.

User: anonymous (no token)
Platform: API all-in-one; production is one process on one shared VM
Environment: local :3620 (same code/mode as prod)
Steps:
  1. Fire 100 concurrent unauthenticated GET /owner/docs/openapi.json?fresh=1 while a signed-in owner
     reads /owner/orders.
Expected: an anonymous request cannot force expensive repeated work; either the endpoint is cheap/cached
or it is rate-limited.
Actual: `?fresh=1` drops the doc cache and re-reads hundreds of rows across ~20 modules, then regenerates
a 1.37 MB document — per request, with no auth and no rate limit. Baseline owner /orders latency ~4–17 ms;
during the flood the first probe jumped to 8.06 s and process CPU hit ~130%. All 100 returned 200.
Business impact: a cheap anonymous loop can degrade the whole product for real users; on the single
all-in-one production VM there is no isolation between this and live traffic.
Severity: P2
Evidence: QA/evidence/p16/docs-fresh-flood.json (floodMs 8486, owner /orders 8059 ms during flood).
Suggested fix: require auth for `?fresh=1` (or remove it in production), cap doc regeneration
concurrency, and/or put a rate limit in front of the docs routes. See also DOS-294.

---

### DOS-294 — No application-layer rate limiting (brute-force protection is per-account lockout only)
Category: security | Priority: P3 | Role: all | Platform: API

User: anonymous / any
Platform: API :3620
Environment: local, isolated DB
Steps:
  1. 500 rapid authenticated GET /owner/orders -> all 200, 951 rps, no 429.
  2. 200 distinct unknown usernames against /auth/auth/login -> all processed (401), ~28 ms each, no throttle.
  3. 200 wrong passwords for one username -> account LOCKS after 5 (423), recovers after 15 min or on
     password reset; the correct password is refused while locked (423).
Expected: an IP/edge rate limit as defense-in-depth in addition to the per-account lockout.
Actual: the only throttle is the 5-attempt/15-minute per-account lockout (works as designed). There is
no application-layer rate limit on login or on any protected route; the system relies entirely on
Cloudflare in front. Username-enumeration timing was tested and is NOT vulnerable — the unknown-username
path runs a dummy argon2 verify, so unknown (median 26 ms) and known-wrong-password (median 27 ms) are
indistinguishable.
Business impact: distributed or low-and-slow credential attacks, and endpoint flooding, are unmitigated
at the application if Cloudflare is bypassed or misconfigured.
Severity: P3
Evidence: QA/evidence/p16/flood-get.json, bruteforce.json, timing-oracle.json.
Suggested fix: add an IP-based rate limit (and confirm Cloudflare rules cover /auth and /docs).

---

### DOS-295 — Missing security headers (HSTS, CSP, frame protection)
Category: security | Priority: P3 | Role: all | Platform: Web + API (production)

User: any browser user
Platform: https://www.distributionos.in and https://api.distributionos.in
Environment: LIVE, observed via HEAD/GET
Steps: HEAD the site and the API; inspect response headers.
Expected: Strict-Transport-Security on both; a Content-Security-Policy and X-Frame-Options/frame-ancestors
on the static site.
Actual: NO Strict-Transport-Security header on www, api, or apex. NO Content-Security-Policy and NO
X-Frame-Options on the static site. (Cloudflare does add x-content-type-options: nosniff and
referrer-policy: strict-origin-when-cross-origin on www; http apex 301-redirects to https.) The API is
JSON so XSS/clickjacking impact is limited, but HSTS is expected for a financial product, and without it
a first-visit active MITM can strip HTTPS before the redirect.
Business impact: weaker transport and clickjacking posture than a money-handling app should have.
Severity: P3
Evidence: QA/evidence/p16/public-observations.txt (REQ1, REQ2, REQ13, REQ14).
Suggested fix: enable HSTS (with preload) at Cloudflare for the domain, and add a CSP + frame-ancestors
to the static site's response headers (`_headers` on Cloudflare Pages).

---

### DOS-296 — NUL byte in a text field returns 500; /health and unknown routes disclose full topology
Category: reliability | Priority: P3 | Role: any authenticated / anonymous | Platform: API

User: any authenticated user (NUL); anonymous (topology)
Platform: API :3620 / production
Environment: local :3620; topology confirmed on prod
Steps:
  1. As owner, POST /owner/retailers with name `Shop\u0000Name` -> 500 {"code":"INTERNAL_SERVER_ERROR",
     "message":"Internal server error"} (Postgres rejects the NUL byte; input validation does not).
  2. GET /health and any unknown route -> JSON listing all 8 services with roles + module names.
Expected: a NUL byte is a clean 400 validation error; the public root health does not enumerate the
internal service/role/module map.
Actual: NUL byte -> 500 (no stack trace or SQL leaked — message is generic, which is good). `/health`
and every unknown route return the full all-in-one topology (service names, roles, contractKeys)
unauthenticated. Other error surfaces were clean: malformed JSON -> 400, wrong types -> 400 (Zod field
list, no internals), wrong content-type -> 415, >26 MB body -> 413, 100k-deep JSON -> 400 (no crash,
health stayed 200).
Business impact: NUL byte is a malformed-input reliability nit; the topology disclosure is minor
reconnaissance value.
Severity: P3
Evidence: QA/evidence/p16/injection.json (unicode_null 500), public-observations.txt (REQ2, REQ7).
Suggested fix: reject control characters (incl. `\u0000`) in text schemas (400); trim `/health` to a
status flag in production and 404 unknown routes without the service list.

---

### DOS-297 — Android release APK: debug-signed and android:allowBackup=true
Category: security | Priority: P3 | Role: mobile users | Platform: Android

User: Android app user
Platform: frontend/dos-app/android/app/build/outputs/apk/release/app-release.apk
Environment: unzipped + apksigner/aapt2 in scratchpad
Steps: inspect signer cert, manifest flags, and scan the JS bundle.
Expected: a store build signed with a private upload key; allowBackup=false for a financial app.
Actual: signer DN is `CN=Android Debug, OU=Android, O=Unknown` (debug keystore — documented in docs/33
as a sideload build, not Play-Store). `android:allowBackup=true`. GOOD: targetSdk 36 so cleartext is
disabled by default, no networkSecurityConfig override, not `debuggable`, and NO secrets in the bundle
(no demo password, private key, tokens, or signing secret; only https://api.distributionos.in plus
harmless localhost dev defaults). Native refresh token uses expo-secure-store (Keychain/EncryptedSharedPreferences).
Business impact: debug signing gives no authenticity/anti-tamper guarantee; allowBackup=true can let app
data be pulled via `adb backup` on some devices (though SecureStore is Keystore-wrapped).
Severity: P3
Suggested fix: sign release builds with a private upload key and set android:allowBackup=false (or a
backup rules file that excludes the secure store). Web note: the refresh token lives in localStorage
(documented, secure=false) — acceptable for a token-auth SPA given rotation + reuse detection, but XSS
would expose it; keep the kit's text-only rendering (no dangerouslySetInnerHTML) as the guard.
