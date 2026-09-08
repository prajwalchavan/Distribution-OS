# Phase 0 observations

Phase 0 is inspection and setup, not review — no product changes, no DOS-numbered findings yet. Two kinds of thing surfaced anyway and are parked here for the phase that owns them.

## A. Confirmed blueprint divergences (from `00-system-understanding.md` §12, each adversarially verified)

Ten of 27 candidate divergences held under a two-lens skeptic check. Carry to **Phase 3** (gap analysis) for categorisation and priority; they are candidates, not yet findings. Grouped by what they'd cost a distributor:

**Workflow / business-logic (walk these in Phase 1–2):**
- **§12.6 The `closed` order state is unreachable.** The `order_state` enum has `closed` but no code transitions into it (`backend/libs/core/src/modules/orders/orders.service.ts`). Delivered orders never reach a terminal "closed" — confirm in the Owner/Manager order lists whether anything is ever archived/closed, and whether that matters for reporting or reconciliation.
- **§12.7 Owner-approval gates are narrower than the diagrammed flow.** Only credit_limit / bargain / below_floor raise an approval at submit; the order otherwise confirms immediately. `docs/22` §4 implies a broader approval step. Walk the Manager approvals screen against real submitted orders.

**Missing capability (Phase 3 / Phase 11 note):**
- **§12.5 OTP is entirely absent from code** though documented as a near-term layer — auth is username+password only. `otp_rate_limits` is used solely by password reset.
- **§12.16 No inbound WhatsApp/SMS webhook exists** (outbound notification handlers exist; nothing receives). Deferred by docs, but a real "reply to confirm" loop is not there.

**Data model / tech-debt (mostly invisible to a user, but real):**
- **§12.4 ADR 0002 says `tenant_id uuid`; the schema stores `text`.** Documentation drift; the code is internally consistent.
- **§12.8 `van_load` is a dead enum value** in the stock-ledger reason enum — no code writes it.
- **§12.11 A dead pricing engine coexists with the live one** — two pricing code paths; only `priceOrder()` is wired. Risk: a future edit to the wrong one. Confirm the dead one is truly unreferenced in Phase 8.
- **§12.21 admin-app is entirely undocumented** in `docs/23` screen inventory (its 12 routes exist and run).
- **§12.23 `x-request-id` is exposed through CORS but never set** by the server — no request-id on responses, which weakens observability (Phase 18).

**Known data hygiene (already on the queue):**
- **§12.26 `pnpm smoke` leaves data behind in the pilot tenant** — see §B.

## B. Live-environment observations (from actually running the apps)

These were seen while getting the apps up. They are NOT yet findings — one had a harness confound, and Phase 0 does not review. Each names the phase that will confirm it.

- **OBS-1 — Android manager app showed the OWNER shell and 403s (needs Phase 1/Manager confirmation).** On the Pixel 7, signing in to the manager APK as `vikas.kadam` reached a home whose phone tabs were `Today · Orders · Money · Shops` (the **owner** app's tab set, not manager's `Today · Orders · Fulfilment · Billing · Inbound · Money · Registers · Shops · Stock`), and every dashboard panel returned **"owner-service does not serve the manager role"** — i.e. the app called owner-service (:3001), not manager-service (:3002). The same manager account on **web** (:5174) rendered the correct manager shell against :3002 with zero errors (`QA/evidence/phase0/web/manager-vikas.kadam-2-home-desk.png` vs `QA/evidence/phase0/android/manager-vikas.kadam-2-home.png`). **Confound:** during the Android run a stray `adb reverse tcp:8081 tcp:5175` from earlier sales debugging was present; it was removed and the manager Android run is being repeated clean. If it reproduces clean, it is a real P1 cross-platform defect (the manager APK loading the wrong app bundle / wrong service). Resolve in Phase 1 (Manager).
- **OBS-2 — the seeded sales rep is mislabeled.** `rahul.deshmukh` (Tarsun salesperson) displays as **"Demo Docs Staff (edited)"** in the sales app; a `pnpm docs:readme`/smoke run renamed him and left 370 `demo.docs.staff*` salesperson accounts in the pilot tenant. Cosmetic for login, but it means the pilot tenant is not a clean demo. See ENV.md §6. Phase 1 (Sales) / Phase 5 (fixtures).
- **OBS-3 — pilot tenant is polluted with smoke/docs data.** 2,473 orders (1,070 draft, 224 cancelled), 1,063 approvals, hundreds of ₹1 receipts under `tarsun`; the shared `dos` DB holds 6,811 tenants / 25,152 users from un-cleaned DB-backed specs. Proposal in ENV.md §6.5: run Stage 1 against a fresh `dos_qa`. Needs the founder's word (Charter A.3).

## C. iOS input path — BLOCKED (render is proven)

Every app **renders** on the iPhone 16 Pro simulator via Expo Go (`QA/evidence/phase0/ios/sales-expo-go-signin.png`). Headless **input** (tap/type) needs Appium's WebDriverAgent, which needs the **iOS 18.2 platform** for Xcode 16.2 (the runtime installed is 18.0, and WDA's build destination requires 18.2 — `xcodebuild ... error: iOS 18.2 is not installed`). Appium 3.7 + XCUITest 12.10 are installed; a `-downloadPlatform iOS` for 18.2 was started. Until it lands (or a physical iPhone is used), iOS is **render-verified only, input BLOCKED** — carried to Phase 15. This does not block Stage 1 (web + Android exercise the same screens and the same native renderer as iOS).
