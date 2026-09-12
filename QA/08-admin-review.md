# 08 — Admin (platform console) review (Phase 1, walked 2026-09-12)

Who: Rohit Nair (`dos.admin`, level `super`) at the Distribution OS console, and Anita Rao (`dos.support`, level `support`) through
the API — the two staff accounts in `platform_admins`. The console serves nobody with a membership: it signs in at
`POST /auth/platform/login`, reads admin-service :3007, and reaches a distributor's own service only through a support window that
distributor's owner opened. Web at desk and phone width, the Pixel 7 debug build, the iOS simulator for sign-in and home, and every
one of the 16 endpoints from three tokens. Findings: `QA/findings/07-walkthrough-admin.md` (DOS-106 … DOS-114).
Evidence: `QA/evidence/phase1/admin/`.

## 1. Answer to the phase question — "Can I manage the system safely?"

**No. Not while a support login can do everything a super can, and the audit trail cannot say who did it.**

What is good — and a lot is: the console is small, plain and honest. It counts, it never shows a rupee of a distributor's trade,
and it says so on every page. Onboarding is one call that leaves a working owner login with a forced password change. Suspension is
real (the owner's sign-in answers 423 with a sentence naming who to call) and reversible. The support model is the best-built thing
in the product: the console can only ask; the owner's service refuses a longer window than was asked; a pass lives five minutes,
reads only, dies with the window, works on one tenant, and every call is written down. I tried to mint on another admin's window,
on a lapsed request, on an expired one and after hand-back: four different refusals, each a sentence a human could act on.

What stops me managing it safely:

1. **Support = super** (DOS-106, P0). `dos.support` set Sai's plan to ₹0.01, onboarded a distributor, suspended one, locked a user,
   and then locked `dos.admin` himself — every call 200. The level column exists and the console never reads it.
2. **A lock has no key** (DOS-107, P1). "Lock this login" is the only action on a person and there is no unlock in any service.
   I restored two accounts with SQL.
3. **The owner cannot answer** (DOS-108, P1). The owner app's Settings has no "Support access" tab although the screen exists in the
   code; the flow "their owner opens the window, in their own app" is impossible from the UI. The API half works.
4. **The audit trail is anonymous** (DOS-109, P1). Sixteen rows, every one "Distribution OS staff"; no reason, no filter.
5. The console and the owner's service disagree on what a lapsed request is (DOS-110), the distributor never learns what support
   read (DOS-111), and per-record mutations use the body `id` and ignore the URL (DOS-112 — the 500 on suspend is that).

Fix 1–4 and this console is safe to hand to a second staff member. Today it is safe only because there is one.

## 2. What I did, screen by screen

| # | Screen | Web desk | Web phone | Android | iOS | Notes |
|---|---|---|---|---|---|---|
| A1 | Sign-in | ✓ (login) | — | ✓ android-login | ✓ ios/-0,-1,-2 | Posts to `/auth/platform/login` (auth log). Console account refused at `/auth/login`, owner refused here — both with a sentence. |
| A2 | Platform (home) | ✓ ad-01 | ✓ p-02 | ✓ a-01 | ✓ home | 3→4 distributorships, working/suspended, people this week, files; Needs attention tiles; plan and state bars; orders/bills a day. "0 support requests waiting" with 3 pending (DOS-110). Plan bars use the tenant plan (DOS-113). |
| A3 | Distributors list | ✓ ad-02, ad-13 | ✓ p-03 | ✓ a-02 | — | Status/plan filters, search (phone: "Name, handle or GSTIN"). Two plan columns (DOS-113). |
| A4 | Distributor detail | ✓ ad-03, ad-14, ad-24 | ✓ p-04 | ✓ a-03, a-03b, a-10, a-15 | — | Counts, who they are, subscription, "Inside this distributorship" (window state, reads, ask/open/hand back). |
| A5 | Suspend / reactivate | ✓ ad-15…ad-18 | — | ✓ a-12 (dialog) | — | Reason required; 423 at sign-in while suspended; reactivate note; both audited. Support level can too (DOS-106). |
| A6 | Change the plan | ✓ ad-25…ad-27 | — | ✓ a-11b | — | Plan/state chips, price, interval, seats, period, trial end, note. Restored Sai exactly; tenants.plan follows. |
| A7 | Ask for support access | ✓ ad-28b, ad-29 | — | — | — | Reason, scope, hours (1–72). Fresh request appears in Waiting + home tile at once. |
| A8 | Open the window / reads / hand back | ✓ ad-31…ad-34 | — | — | — | "Read through the window" panel (name, GSTIN, numbering series); reads listed; hand-back dialog; a 400 after hand-back (DOS-114). |
| A9 | Onboard a distributor | ✓ ad-04, ad-37 | — | ✓ a-14 | — | Inline validation, disabled submit until valid; API onboarding proved end to end (as support — DOS-106). |
| A10 | Subscriptions | ✓ ad-05 | ✓ p-05 | — | — | Filters by state/plan/ending soon; read-only list (DOS-114). |
| A11 | Support access | ✓ ad-06, ad-11, ad-12b, ad-30, ad-36 | ✓ p-01 | ✓ a-04, a-09 | — | Open now / Waiting / All; "Lapsed, no answer" is console-only (DOS-110). |
| A12 | People | ✓ ad-07, ad-20…ad-23 | ✓ p-06 | ✓ a-06, a-13 | — | 52 identities with phone + memberships + last sign-in (correct against auth_sessions); search; Locked out; person panel with "Lock this login" only (DOS-107). Unsorted (DOS-114). |
| A13 | Audit trail | ✓ ad-08, ad-19, ad-35 | ✓ p-07 | ✓ a-07 | — | Empty at start (seed writes no audit), then 16 rows from my actions — all "Distribution OS staff" (DOS-109). |
| A14 | Account / devices | ✓ ad-09 | ✓ p-08 | ✓ a-08 | — | Name, username, "Level: Distribution OS staff" (no super/support), devices with End this session, About, Sign out. |
| A15 | Change password | ✓ ad-10 | — | — | — | Form only (auth module covered in the Retailer walk). |
| A16 | Owner app: Support access | ✗ ow-01, ow-03 | ✗ | — | — | Tab never renders (DOS-108). Settings › Audit shows no support reads (ow-02, DOS-111). |

NOT TESTED: iOS beyond sign-in and home (Appium script signs in only; consistent with the other roles); the console's change-password
submit; Android "Ask for support access" and hand-back dialogs (web-proved); `GET /admin/audit` cursor paging (16 rows).

## 3. Privilege escalation attempts (the charter's explicit ask)

| Attempt | Result | Evidence |
|---|---|---|
| Console account at `/auth/login`; owner at `/auth/platform/login` | 403 each, with the right redirection sentence | api-probes-00 (review §4) |
| Owner token on :3007 (`/admin/tenants`, `/admin/metrics`) | 403 "admin-service does not serve the owner role" | api-13, api-14 |
| Console token on :3001, :3003, :3006 without a pass | 403 "does not serve the platform_admin role" | api-15…api-18, api-20 |
| No token on :3007 | 401 | api-21 |
| Support level doing super things (plan, onboard, suspend, lock a user, lock the super) | **200 on all five** | DOS-106 |
| Owner approving a longer window than asked | 400 "may be shortened, never lengthened" | api-28 |
| Pass minted on another admin's window / lapsed request / expired window / handed-back window | 403 ×4, each a distinct sentence | api-probes-08, -12 |
| Pass used to WRITE; pass on sales/manager/admin services; pass with another account's token; pass with the owner's token | 403 on every one | api-probes-08 |
| Pass reads cost and money (purchase costs, outstanding) | 200 — by design (acts as the owner, read-only); the owner is not told (DOS-111) | api-38, api-39 |
| Same idempotency key, different payload | 409 | api-probes-07 |

## 4. Harness notes for this role

- Sign-in: `pw.mjs login dos.admin Dos@1234 http://localhost:5179/` works unchanged; the form posts to `/auth/platform/login`.
  API tokens: `QA/tools/tok.sh <scratchpad>` re-mints dos.admin, dos.support (platform login), sunil.tarsun and prakash.salunkhe
  (Sai's owner) — access tokens live 15 min and the walk needed three rounds.
- The admin app's sign-in screen says "Distribution OS console", not "Distribution OS - Admin": `android-login.sh admin 5179
  dos.admin ""` (empty title skips the guard) and `ios-login.mjs 5179 dos.admin admin console` (matches "Distribution OS console").
- Per-record console/owner mutations need `id` = the target id in the body (DOS-112); a fresh UUID gives 500/404.
- Support tabs are plain buttons: `getByText('Waiting for their owner')`; `getByRole('button',{name:/^All$/})` for All.
  The ask dialog's hour chips carry a "✓ " prefix when selected. `hand-back` opens a confirm with "Hand it back".
- Android `keyevent 4` on the onboarding form does not leave it; use the tab bar. `ui.py text "Change the plan"` only resolves when
  the button is on screen — swipe first.
- Console errors after actions are worth reading: the post-hand-back 400 (DOS-114) only shows in `[failed requests]`.

## 5. Side effects left in `dos_qa`

- Tenant **qa-probe-support** ("QA Probe Support Pvt Ltd", pilot → starter/trialing ₹999 after the idempotency probe), owner
  `qa.probe.owner` / `Dos@1234` (mustChangePassword true; locked by the probe, restored to active by SQL). Counts on the console
  home now say 4 distributorships. Not removable through the product.
- Sai Distributors' subscription restored to Standard / trial / ₹1,999 / 10 seats / trial 1 Oct / "Free trial from onboarding.";
  `tenants.plan` for Sai is now `standard` (the seed had `starter`).
- Support grants: dc9b8792 (Tarsun, dos.admin's 72 h) handed back at 19:39; 01a095f1 (#9001 on Sai) approved 2 h by Sai's owner
  through the API, read once, revoked at 19:49. The three 12:50 requests from dos.support remain "requested"/"lapsed".
- platform_audit: 0 → 20 rows. `dos.admin` was disabled by `dos.support` at 19:52 and restored by SQL; his three device sessions
  (web, Android, iOS) were revoked — the console tab, the Pixel and the simulator are signed out at their next refresh.
- Sessions: "QA curl admin" ×6 on the two console accounts, "QA curl owner" on sunil.tarsun and prakash.salunkhe.
