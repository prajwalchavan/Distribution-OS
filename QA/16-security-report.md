# Phase 16 — Security & file security report

Run 2026-09-28. Tester lane; no product code changed. Attacks ran against a LOCAL production-mode API
on :3620 over an isolated database copy (`dos_test_p16_security`). The public live hosts were only READ,
with 14 unauthenticated GET/HEAD/OPTIONS requests (no credentials, no payloads). Findings DOS-290..297 in
`QA/findings/14-security.md`; evidence in `QA/evidence/p16/`; tools in `QA/tools/p16/`.

**Status 2026-09-28 08:35 IST:** DOS-290, DOS-291 and DOS-293 are fixed and live (main `a3eb5981`, founder approved); the public host was checked after the deploy. DOS-292, 294, 295, 296, 297 are open and go to the change backlog.

## The headline

- **DOS-290 (P0):** the live API serves its interactive documentation and OpenAPI to anyone,
  unauthenticated, and those examples are built from your REAL data — the pilot shop names, phone
  numbers, GSTINs, a staff login username and your UPI payment id are readable at
  `https://api.distributionos.in/owner/docs/openapi.json`. Turn the docs off in production, or feed them
  fake examples.
- **DOS-291 (P1):** on the live server, opening any file — an invoice PDF, a delivery photo, a logo —
  returns 404. The file links are minted without the `/owner` (etc.) prefix the all-in-one server needs,
  so nothing serves them. The access CONTROL around files is fine; the serving is simply broken.

## What was tested, and the result

| Area | Result |
| --- | --- |
| Auth without a token / garbage token (every operation of all 8 services enumerated) | PASS — every protected route 401s; only genuinely public routes (login, refresh, logout, forgot/reset, jwks, health/ping) answer without a token |
| Role gate (wrong-role token on a service) | PASS — 403 "service does not serve the X role" (salesperson/retailer refused on owner/manager/warehouse) |
| Cost-visibility isolation (salesperson) | PASS — no cost/purchase fields exposed to the salesperson service |
| SQL injection (free-text fields, ?q=, sort, cursor, limit) | PASS — parameterized; no 500s, no SQL/stack/path leakage; pg_sleep did not delay |
| Stored XSS (`<script>`, `<img onerror>` in names/notes) | PASS at render — stored verbatim, but the web app escapes text and has NO dangerouslySetInnerHTML/innerHTML/WebView-with-user-data |
| Username-enumeration timing oracle | PASS — dummy argon2 verify equalizes unknown vs known (26 vs 27 ms) |
| Brute force | Per-account lockout works (5 tries → 15-min lock; correct password refused while locked). No app-layer/IP rate limit → **DOS-294 (P3)** |
| Error handling (malformed JSON, wrong types, 415, >26MB→413, 100k-deep JSON) | PASS — clean 400/413/415, no crash, no internals leaked. NUL byte → 500 not 400 → **DOS-296 (P3)** |
| CORS (foreign origin, allowed origin, preflight, credentials) | PASS — foreign origin gets no ACAO; only listed origins allowed; credentials disabled |
| Signed file URLs — tamper, expiry, no-signature | PASS — bad/absent signature, past expiry, and expiry-bumped-without-resigning all rejected (403) |
| Cross-tenant file access | PASS — a tenant asking for another tenant's object key → 400 "does not belong to tenant" |
| Cross-retailer file access | PASS — a retailer asking for another retailer's invoice → 403 |
| Path traversal / odd keys (`..`, absolute, backslash, bad) | PASS — all 400/403; storage root cannot be escaped |
| File serving in production all-in-one | **FAIL — DOS-291 (P1):** minted `/storage/…` URLs are unroutable (404) |
| CSV/formula injection in exports | **FAIL — DOS-292 (P2):** `renderCsv` does not neutralize `= + - @` leads |
| Unauthenticated docs DoS amplification (`?fresh=1`) | **FAIL — DOS-293 (P2):** anonymous flood stalled real traffic to 8 s |
| API docs exposure + real-data leak (production) | **FAIL — DOS-290 (P0)** |
| Secrets in the web bundle (local + downloaded production bundle) | PASS — none; only `api.distributionos.in` + harmless localhost dev defaults |
| Secrets in the Android release APK | PASS — none in the JS bundle; app data uses Keystore-backed secure store |
| APK signing / manifest | Debug-signed, allowBackup=true → **DOS-297 (P3)**; cleartext disabled, not debuggable (good) |
| Committed secrets in git | PASS — none (only AWS's public doc example key in a test vector); `.env` is git-ignored; no keystores committed |
| Server env-file handling (vm-setup.sh) | PASS by inspection — secrets generated at runtime, written once to `/opt/dos/env/*` with `chmod 600`, never printed |
| Security headers (HSTS/CSP/frame) | Missing → **DOS-295 (P3)**; http→https 301 and nosniff/referrer-policy present |

## NOT TESTED (and why)

- **Live sign-in / any authenticated action on production.** Forbidden by lane rules — no login was ever
  sent to the public API. So live RLS isolation, live receipts, and the placeholder "(test)" staff
  accounts were not exercised on production.
- **Whether the 5 placeholder "(test)" staff on live still have password `Dos@1234`.** The live docs text
  still says "every demo user's password is Dos@1234". docs/33 says to rename/disable those accounts.
  If any remain with the default password, that is a live weak-credential hole. Cannot be tested without
  signing in to production (forbidden) — please verify in the app.
- **iOS.** No device/simulator tap available (CLAUDE.md); token storage was verified by code
  (expo-secure-store → Keychain) but not run on iOS.
- **Push/SMS/WhatsApp deep-link and notification-tap security.** No live channel credentials; the reset
  token is only logged outside production and not delivered.
- **Real S3 driver signed URLs.** Production uses the local driver; the S3 SigV4 path was not exercised
  against a bucket (unit-tested in-repo against AWS's published vector).
- **True RLS cross-tenant data reads over the wire.** Tenant comes from the token claim, not the request,
  so a cross-tenant read needs a token for that tenant; RLS itself is covered by the DB guarantee tests,
  not re-run here.

## Suggested order of fixing

1. DOS-290 (P0) — stop serving live-data docs on production.
2. DOS-291 (P1) — fix file-URL routing so invoices/photos open again.
3. DOS-292, DOS-293 (P2) — CSV formula escaping; protect the docs regeneration endpoint.
4. DOS-294..297 (P3) — rate limiting, security headers, NUL-byte 400, APK signing/backup.
