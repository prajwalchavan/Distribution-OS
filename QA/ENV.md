# ENV — reproducible setup and install log

Everything here was run on the founder's Mac (macOS 14.6.1, Apple Silicon) on 2026-09-07/08. Product-side setup is
`docs/28-running-it-locally.md`; this file records what the QA programme added and what it found about the environment.

## 1. Toolchain already present (verified, not installed by QA)

| Tool | Where | Check |
|---|---|---|
| Node 24 via fnm, pnpm 11 | `export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24` — **every shell** | `node -v` → v24 |
| Postgres 17.11 | Homebrew `postgresql@17`, **127.0.0.1:5439**, `dos:dos`, database `dos` | `psql -h 127.0.0.1 -p 5439 -U dos -d dos -c 'select 1'` |
| Xcode 16.2 + iOS 18.0 runtime (+ 18.3.1 since 2026-09-08, §2) | `/Applications/Xcode.app` | `xcrun simctl list devices booted` → iPhone 16 Pro |
| Android SDK + emulator | `~/Library/Android/sdk`, AVD `Pixel_7_API_36`, JDK = Homebrew `openjdk@21` | `adb devices` |
| Debug APKs, all seven apps | `frontend/<app>-app/android/app/build/outputs/apk/debug/app-debug.apk` (built by the frontend gates) | — |
| Expo Go on the iOS simulator | `host.exp.Exponent` installed on iPhone 16 Pro | `xcrun simctl listapps booted` |

## 2. Installed by QA (install log)

```bash
# 2026-09-07  Playwright + headless Chromium, project-local under QA/tools (NOT in the product workspaces — their lockfiles stay untouched)
cd QA/tools && npm install --no-audit --no-fund          # playwright 1.58.2  (QA/tools/package.json)
npx playwright install chromium                          # Chrome Headless Shell 145.0.7632.6 → ~/Library/Caches/ms-playwright/chromium_headless_shell-1208 (91 MB)
# 2026-09-08  Appium 3 + XCUITest driver (headless iOS input through WebDriverAgent), project-local
npm install --no-audit --no-fund appium@latest            # appium 3.7.0 (appium 2.x refuses the current xcuitest driver — it needs ^3)
npx appium driver install xcuitest                        # xcuitest 12.10.0
# 2026-09-08  iOS platform for Xcode 16.2 — WebDriverAgent's build destination needs the 18.2 SDK's platform; Apple served 18.3.1
xcodebuild -downloadPlatform iOS                          # ~7 GB, no Apple ID prompt, ~40 min → runtime "iOS 18.3.1 (22D8075)"
```

Nothing global was changed. No system settings were touched.

## 3. How everything is started (what QA actually ran)

```bash
# Database — a Homebrew service; nothing to do. If down: brew services start postgresql@17
# Eight services + worker, background, logs in ~/.dos-qa-logs/logs (DATABASE_URL from backend/.env):
QA/tools/start-services.sh
# The seven Expo web servers (:5173–:5179) + worker in the background:
QA/tools/start-all.sh
# Android emulator, headless (no window on the founder's screen), 3 GB — mandatory, see CLAUDE.md:
export ANDROID_HOME=$HOME/Library/Android/sdk; export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save -no-window -no-audio &
adb wait-for-device; adb shell getprop sys.boot_completed   # 1 = ready (~60 s)
# iOS simulator — booted (iPhone 16 Pro, iOS 18.0). Never open Simulator.app or the Claude simulator panel (founder rule).
cd QA/tools && npx appium --port 4723 &                      # the iOS input path (§5.4)
xcrun simctl openurl booted "exp://127.0.0.1:5175"          # loads an app into Expo Go from its Metro (Appium does this itself)
xcrun simctl io booted screenshot <file.png>
```

## 4. QA harness (QA/tools/)

| File | What it does |
|---|---|
| `login-all.mjs [filter]` | Playwright: signs in to every web app as every role (8 accounts), screenshots sign-in, home at 1280×800 and 390×844, records console errors and ≥400 responses → `QA/evidence/phase0/web/`, `results.json` |
| `probe-signin.mjs <url>` | dumps the interactive elements of a sign-in page (how the selectors below were found) |
| `android-login.sh <app> <port> <user> <TitleWord>` | installs the app's debug APK, points host:8081 at its Metro, wipes the app, checks the title, fills sign-in through `adb shell input`, screenshots → `QA/evidence/phase0/android/` |
| `android-all.sh` / `android-rest.sh` / `android-redo.sh` | sequential runners over the apps (one app at a time, §5.6) |
| `ui.py` | uiautomator helper: centre of the Nth EditText / of a node by text, `has-edit`, `texts`; retries empty dumps |
| `proxy8081.mjs <port>` | TCP forwarder host:8081 → the app's Metro port (§5.1) |
| `ios-login.mjs <metroPort> <user> <app>` | Appium/XCUITest: opens the app in Expo Go on the booted simulator, types the sign-in, screenshots → `QA/evidence/phase0/ios/`. **No Simulator window, no Claude panel.** |
| `start-services.sh`, `start-all.sh` | background starters (§3) |

Sign-in form selectors (identical in all seven apps): web `data-testid` = `sign-in-username`, `sign-in-password`, `sign-in-submit`; Android = 1st/2nd `EditText` + button text "Sign in" (no resource-ids are exposed); iOS = `XCUIElementTypeTextField`, `XCUIElementTypeSecureTextField`, button label "Sign in".

## 5. Environment facts QA discovered (each cost time; recorded so nobody pays twice)

1. **The debug APKs are plain React Native debug builds, not Expo dev clients.** They ignore `dos-<app>://expo-development-client/?url=…` and fetch their bundle from `10.0.2.2:8081` (the emulator's alias for the host) — `adb reverse` cannot redirect that. Each app's Metro runs on its own port (5173–5179), so `proxy8081.mjs <port>` forwards host :8081 to the app under test; one Android app at a time. Evidence: `adb logcat` — `Failed to connect to /10.0.2.2:8081`.
2. **The emulator throws "System UI isn't responding" while the first bundle builds** even at 3 GB; tapping *Wait* is enough. First bundle per app ≈ 60–120 s.
3. **`uiautomator dump` exposes no `resource-id` for React Native `testID`s** on this build — the scripts locate fields by widget class order and buttons by text.
4. **iOS headless input works via Appium + WebDriverAgent** (2026-09-08). `xcrun simctl` has no tap/type verb, `idb-companion` needs macOS 26, AppleScript needs Accessibility + a window (barred). Appium's XCUITest driver builds WDA and drives the simulator with no window; the only blocker was the missing iOS 18.2+ platform (`xcodebuild: error: iOS 18.2 is not installed`), fixed by `xcodebuild -downloadPlatform iOS` without a password. Proof: `QA/evidence/phase0/ios/sales-rahul.deshmukh-2-home.png`. This most likely also unblocks `expo run:ios` — not yet re-tried.
5. **Playwright**: `new URL(...).pathname` percent-encodes the space in "Distribution OS" — use `fileURLToPath`.
6. **Android: one app at a time, and wipe it first.** With one shared `:8081` Metro port, a run that switched apps too quickly served app A's bundle to app B's APK, and `adb shell input text` APPENDS to whatever a previous session left in the field (we saw `dos.adminganesh.more`). Both produced screenshots that looked like product bugs and were not. The driver now waits for the proxy to answer, `pm clear`s the package, checks the on-screen title is `Distribution OS - <App>` before typing, and clears each field. Never leave a stray `adb reverse tcp:8081` behind (`adb reverse --remove-all`).
7. **`uiautomator dump` sometimes returns nothing mid-animation**; `ui.py` retries four times before reporting an empty screen.
8. **Expo Go shares one sandbox across all seven apps on the simulator.** After signing in to the owner app, opening the manager app in Expo Go came up with the OWNER's session (manager shell, "manager-service does not serve the owner role") — the refresh token lives in the keychain, which Expo Go does not scope per project. A dev build or a real device gives each app its own sandbox, so this is an environment artefact, not a product defect; `ios-login.mjs` resets the simulator keychain between apps (`xcrun simctl keychain <udid> reset`). Also: XCUITest types into whichever field has focus — click a field before sending its value — and iOS shows a "Save Password?" sheet after a successful sign-in that must be dismissed.
9. **The owner "Today" numbers are a worker rollup.** With the worker down the dashboard showed "as of 9:26 pm" at 10:35 pm (stale but labelled); it caught up once the worker started. Phase 1 (Owner) should judge whether "as of" is honest enough.

## 6a. QA database since 2026-09-12: `dos_qa`

The new realistic seed (`pnpm db:seed`, commit 472a5df) refuses to run over a database seeded by the old code, and the tool guard would not let QA drop `dos`, so QA created **`dos_qa`** (createdb → `pnpm db:migrate` → `pnpm db:seed`, ~25 s) and runs every service against it: `QA/tools/start-services.sh` exports `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_qa` (override by setting DATABASE_URL first). `backend/.env` still points at `dos`; anything the founder starts by hand hits the OLD data unless they export the same variable or replace `dos` themselves (`dropdb --force dos && createdb dos && pnpm db:migrate && pnpm db:seed`). Seeded on 2026-09-12: 3 tenants, 52 users, 174 variants, 127 shops, 1 544 orders, 1 501 bills, 1 170 receipts, 175 trips; `QA/tools/seed/verify-seed.sh dos_qa` → 206/206. All eight web sign-ins re-verified on it (0 console errors, 0 failed requests).

## 6. The database — read this before any destructive step (Charter A.3)

**2026-09-08 (founder, in chat: "drop it, create new seed, more realistic one"):** the polluted `dos` was dropped after stopping the eight services and the worker (`dropdb dos`), recreated empty, migrated (43 migrations) and base-seeded (`pnpm db:seed`: 3 tenants, 42 users, 103 retailers, 17 products / 29 variants, 234 orders, 243 invoices, 251 receipts, 52 trips, 297 ledger rows). A realistic rebuild of `seed-demo` is in progress (spec: `QA/tools/seed/REALISTIC-SEED-SPEC.md`). Five stray `dos_seedtest_*` databases from the seed test remain (small). **`pnpm test` in backend re-pollutes `dos`** — DB-backed specs create tenants/users and never clean up; until the specs get their own database this is a hygiene finding for Phase 3/6. Run backend tests only against a scratch `DATABASE_URL`.

What was found before the drop, kept for the record:

- Name `dos` — neither `test` nor `dev`, so under A.3 nothing destructive ran until the founder said so.
- It was a **shared dev database**: the product's DB-backed specs create their own tenants/users with unique suffixes and never clean up. Counts on 2026-09-07: **6,811 tenants, 25,152 users**, 11,229 sales orders, 13,798 stock-ledger rows. The platform console showed "6,811 distributorships". Only three tenants were the demo: `tarsun` (Tarsun Enterprises, GSTIN 27CNGPP9039R1ZX), `sai-distributors`, `kalyan-agencies`.
- The pilot tenant itself was polluted: **370 salesperson accounts** (`demo.docs.staff1…367`, one per `pnpm smoke` run), **2,473 orders** (1,070 draft, 224 cancelled), **1,063 approvals**, 561 trips, 470 receipts. The seeded rep `rahul.deshmukh` displayed as "Demo Docs Staff (edited)" because a smoke run renamed him.
- The seed carries **Tarsun Enterprises' real legal name, GSTIN, address and logo** (founder's choice, docs/28 §3); every transaction under it is fictional. No real invoice, retailer or payment data was found.

## 7. Seeded sign-ins (password `Dos@1234` everywhere; base seed — the realistic seed keeps these)

| Role | App / port | Tenant `tarsun` | also in `sai-distributors` / `kalyan-agencies` |
|---|---|---|---|
| owner | owner :5173 | `sunil.tarsun` (also `pilot.owner`) | `prakash.salunkhe` / `nitin.bhoir` |
| manager | manager :5174 | `vikas.kadam` | `sanjay.bhosale` / `ashok.kulkarni` |
| accountant | manager :5174 | `meena.joshi` | `nilesh.wagh` / `swati.naik` |
| salesperson | sales :5175 | `rahul.deshmukh`, `amit.pawar`, `pooja.shinde` | `kiran.mhatre`… / `anita.sonawane`… |
| warehouse | warehouse :5176 | `dinesh.patil`, `kavita.sawant` | `bharat.jadhav`… / `manisha.palve`… |
| delivery | delivery :5177 | `ganesh.more`, `iqbal.shaikh`, `raju.yadav`, `santosh.kamble` | 4 each |
| retailer | retailer :5178 | `ramesh.gupta` (member of all three), `fatima.shaikh` (tarsun + sai) | `suresh.chauhan` (kalyan only) |
| platform_admin | admin :5179 | `dos.admin` (super), `dos.support` (support) — `POST /auth/platform/login`, no membership | — |

## 8. Phase 1 harness (added 2026-09-12, Owner walk)

| File | What it does |
|---|---|
| `pw-server.mjs` | one headless Chromium kept alive with CDP on :9333 so short commands share a signed-in session: `nohup node pw-server.mjs > ~/.dos-qa-logs/logs/pw-server.log 2>&1 &` |
| `pw.mjs <cmd>` | one command per process against that browser: `login <user> [pass] [url]`, `goto <url> [shotName]`, `shot <name>` (full-page PNG + innerText `.txt`), `phone <name>` / `desk` / `size w h`, `text`, `click <sel|text>`, `fill`, `press`, `refs` (interactive elements), `do "<async JS with page, settle, shot, sel>"`. Every run prints console errors and ≥400 responses it saw. Evidence dir = `QA/evidence/$EV_DIR/` (default `phase1/owner`). |
| `pw-audit.mjs <base> <routes…>` | visits each route, reports console errors, failed requests and error-looking page text |
| `pw-net.mjs <url> <name>` | saves every API response of one page load to `evidence/<EV_DIR>/net-<name>/NN-METHOD-path.json` |

Notes learned this phase:
- The Bash tool's shell is Node 22 unless `fnm use 24` is run; Playwright is fine on either.
- On a `connectOverCDP` browser, `browser.close()` only disconnects — the server's context and page survive between commands.
- Android: the first bundle still triggers "System UI isn't responding"; `android-login.sh` waits for the sign-in form, so tap *Wait* (`ui.py text Wait`) and it proceeds. Owner APK signed in fine after that. Remove `adb reverse` afterwards (`adb reverse --remove-all`).
- iOS: `ios-login.mjs 5173 sunil.tarsun owner` worked first time with Appium already on :4723 and the simulator booted headlessly (`xcrun simctl boot <udid>`); Expo Go's gear overlay sits over the "⋯" menu in screenshots.
- `psql` path must be exported (`export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH`); zsh does not word-split a `$P` command string — define a function instead.

Notes from the Manager walk (2026-09-12):
- `pw-server.mjs` can hang between sessions (CDP socket connects, no answer → `connectOverCDP: Timeout 30000ms`). Kill `pw-server.mjs`
  and the `remote-debugging-port=9333` Chromium, relaunch, then sign in again — the old page is lost.
- Side panels are `.dos-backdrop` overlays (`data-testid` = `invoice-panel`, `wave-dialog`, …). While one is open, page-level
  locators resolve but the click is intercepted; target the button INSIDE the overlay (`page.locator('.dos-backdrop').last().getByRole(...)`)
  or press Escape first. Confirm dialogs stack a second backdrop over the panel.
- To see WHY a mutation did nothing, wrap the click in `page.waitForResponse(r => r.request().method() === 'POST' …)` and read
  `resp.text()` — the app shows no error text (DOS-029). pw.mjs still prints `[failed requests]` per command.
- After an uncaught ApiError in the dev build, Expo leaves an empty `#error-overlay` that intercepts every pointer event
  (Playwright: "intercepts pointer events", `isVisible()` false). Reload the page.
- `refs` indexes shift between roles (the accountant's rail has fewer links) — filter by `data-testid` (3rd column), not by index.
- A manager API token: `POST /auth/login {username, password, deviceId:<uuid>}` on :3000 (deviceId must be a UUID); 15 min life.
- The worker died once during the walk (log stopped, no process); restarted with `DATABASE_URL=…/dos_qa pnpm --filter @dos/worker dev`.
  A first pgrep pattern missed the surviving old pnpm wrapper and produced a duplicate worker — check `pgrep -fl "@dos/worker"` before starting one.
- Android: after `android-login.sh`, drive with `ui.py text <label>` + `adb shell input tap`; the bottom tabs are Today/Orders/Fulfilment/Billing,
  the rest is behind "⋯". Row cells with no text show as "￼" in `ui.py texts` (e.g. the hidden shop-name column).

Notes from the Warehouse walk (2026-09-12):
- Keypads (count, pack, gate, load) are plain `<button>`s whose `aria-label` is lowercase ("clear"), so `getByRole('button', {name:'Clear', exact:true})`
  fails; use `page.locator('button', { hasText: /^Clear$/ })`. Digit buttons repeat per keypad on the pack screen — pick by index.
- Confirm dialogs on this app are `.dos-backdrop[data-testid=w6-dialog]` (pack) / `.dos-backdrop` (load, count); click the button INSIDE
  the dialog or Playwright reports "subtree intercepts pointer events".
- Picks and gate/cycle counts do NOT call `/warehouse/...` directly: they go through `POST /sync/upload` (offline outbox). Wait on that
  URL to read the accept/reject; rejections are also durable in `sync_ops` (`outcome->'rejection'`), and the tray at `/pick/attention`.
  A retry resends the same opId → `replayed:1` with the stored outcome (DOS-046).
- The picking screen's `.dos-backdrop` for Short is opened per line (`w5-short-<lineId>`); reason chips are text, not role buttons.
- `pw.mjs do` loses its return value when any step throws — wrap probes in try/catch or keep chains short.
- Warehouse and manager API tokens expire after 15 min — re-login (`POST /auth/login` with a UUID deviceId) before a batch of probes.
- To put a GRN in front of the gate, open it as the manager: `POST :3002/procurement/grns {idempotencyKey, id (UUIDv7), supplierInvoiceId, locationId}`
  on an `approved` supplier invoice with no GRN (`api-grn-open.txt`).
- Android: the debug build's LogBox ("Can't perform a React state update…") opens on the first tap and swallows `ui.py text` lookups —
  `ui.py text Dismiss` + tap, then continue. Wave/sheet rows are below the fold on the phone: `adb shell input swipe 540 1800 540 900 400` first.
- iOS: `ios-login.mjs 5176 dinesh.patil warehouse` worked first time (Appium on :4723, simulator booted); ~1 min.

Notes from the Delivery walk (2026-09-12):
- **Android reaches the API over `adb reverse` (localhost:3000/3005 on the device → host), not over IP.** `svc wifi disable`, `svc data disable`
  and airplane mode cut the radio (ping 10.0.2.2 → "Network is unreachable") but NOT the app's API calls. To simulate offline: `adb reverse
  --remove tcp:3000` and `--remove tcp:3005` AND `am force-stop` + relaunch the app — an established keep-alive socket survives the removal
  (a delivery went through on a "dead" network that way, `delivery-service.log` req-3hk). The debug bundle still loads from 10.0.2.2:8081 with the
  radio up, so keep airplane mode OFF for that variant. Restore with `adb reverse tcp:3000 tcp:3000; adb reverse tcp:3005 tcp:3005`.
- **Playwright `context.setOffline(true)` does not survive between `pw.mjs` processes** (each command reconnects over CDP). Do the whole offline
  scenario inside ONE `pw.mjs do "…"`: setOffline → actions → waits → setOffline(false). The `d-43/d-44` screenshots of the delivery walk were an
  online run for that reason.
- After an uncaught error the RN dev build shows a LogBox toast at the bottom that covers the primary button; a tap there opens the log viewer
  (Back closes it, then tap the toast's × at ~(996,2209) on the Pixel 7). Not a product defect.
- `adb shell input text` only works on real TextInputs; the delivery app's amount field opens a full-screen keypad sheet (buttons, tap by label
  with `ui.py text 4`). `adb shell input keyevent 111` (Escape) closes the keypad sheet; `keyevent 4` (Back) navigates when no keyboard is open.
- Camera on the emulator: the app hands off to the system camera (`com.android.camera2`); tap `content-desc="Shutter"` then `"Done"` — parse
  `uiautomator dump` for content-desc (`/tmp/uidesc.py` pattern in the session; add to `ui.py` when next needed). The stored JPEG is real
  (1392×1856, `backend/.storage/tenant/<id>/pod/…`).
- The Google "Location Accuracy" system dialog appears on every location use; `ui.py text "No thanks"` dismisses it. `adb emu geo fix 73.1421 19.2313`
  sets a Kalyan position.
- The `deliveries` table carries a `plan:` row per stop (idempotency_key `plan:<stopId>:<invoiceId>`, outcome NULL) — that is how a stop maps
  to its invoice before delivery.
- Seed hygiene found here: the RCPT numbering series was left at 696 while receipts up to RCPT-0699 exist, so the first four app receipts of
  the day collided (DOS-059). Not fixed (founder: no more seed work) — fix together with the unique index when DOS-059 is approved.

Notes from the Sales walk (2026-09-12):
- **Android `keyevent 4` (Back) is in-app navigation, not "close keyboard"**: on the order screen it went back to the shop card, then
  the beat, then OUT of the sales app into the previously fronted delivery app, where the rest of a scripted walk tapped blindly (all
  misses — nothing changed, log `android-sales-walk2.log`). Close the soft keyboard with `keyevent 111` (ESC) as `android-login.sh`
  does; bring the app back with `adb shell am start -n in.distributionos.sales/.MainActivity`.
- On the Pixel the order-entry catalog rows have collapsed bounds (`[467,710][675,184]`), so `ui.py text "Add a case"` returns
  coordinates that hit nothing; tap from a screenshot instead (DOS-077). The soft keyboard stays up after `input text` and covers the
  list — the first walk's "Add a case" taps hit the keyboard.
- Web: the order screen's "Pieces" is a +1 button, not an input; `input[type=text]` on that page is the "Note for the office" field.
  The `.dos-backdrop` dialogs here: visit (`check-in`), bargain (`ask-bargain`), cancel; the tab buttons ("Orders25", "Bills6") need
  `locator('button', { hasText: /^Orders\s*25$/ })`, not getByRole.
- `pw.mjs do` runs as an ES module — `require` is undefined; collect captures in memory and print them, or write with `fs` imported.
- The sales token expires after 15 min like the others (`POST /auth/login` with a UUID deviceId); each API login adds an
  "Unnamed device" row to the rep's Settings device list — expect four such rows from this walk.
- `pnpm smoke`-free, but this walk left: SO-0879 (credit hold pending), SO-0881/0883/0884 confirmed, SO-0880 cancelled, SO-0870 (Amit's)
  cancelled by the DOS-073 probe, shop R-9025 "Kalyan QA Kirana", a pending bargain (₹13.00 Balaji Masala Masti), one visit. The Tier C
  rate of Neelam Neem Soap was set to 27.50 for DOS-082 and restored to 26.08.
- Sync-pull evidence method: `grep '"url":"/sync/pull' sales-service.log` bucketed per minute; decode `since=` with base64 → `{"v":1,"t":…}`.

Notes from the Retailer walk (2026-09-12):
- `pw.mjs` drives the LAST page of the shared context. A click that opens a new tab (the bill's "Open the bill") makes that popup
  the page every later command uses; closing "the other pages" then closes the real app tab. Close the popup itself and re-`login`
  if the app tab is gone (its refresh token has rotated meanwhile → 401 on /auth/refresh → sign-in page).
- A password change revokes every other session: the Android app dropped to the sign-in form ~15 min later when its access token
  expired. Re-sign-in on the form without re-running `android-login.sh`: `ui.py edit 1` / `edit 2` give the field centres,
  `ui.py text "Sign in" | tail -1` the button.
- On the retailer order screen the Pixel's `uiautomator` bounds for the steppers are inverted ([586,615][615,518]) like DOS-077;
  tap the "+" from a fresh `screencap` (first row at ≈(600,1386) on the unscrolled Bourbon search, 1080×2400 frame). Any swipe
  scrolls the list, so re-screenshot before each pixel tap.
- The RN LogBox toast at the bottom (y≈2209) swallows every tap on the primary button underneath; tap the toast to open the viewer,
  Back, then the × at (996,2209). `adb logcat -d | grep ReactNativeJS` has the full error text (uiautomator truncates it).
- `pw-net.mjs` and the retailer service log are the fastest way to see relative vs absolute URLs coming back from the API (DOS-099).
- A retailer API token: `POST /auth/login {username, password, deviceId:<uuid>}` on :3000; the login reply carries `tenant` (the
  first membership) — no `tenantId` is needed for a three-tenant user, the service picks the first.

Notes from the Admin walk (2026-09-12):
- Console accounts sign in at `POST /auth/platform/login` (no tenant); `QA/tools/tok.sh <scratchpad>` re-mints the four probe tokens
  (dos.admin, dos.support, sunil.tarsun, prakash.salunkhe) — access tokens last 15 min, so a long API walk needs it every quarter hour.
- The admin app's sign-in screen reads "Distribution OS console", so the title guards in `android-login.sh`/`ios-login.mjs` need
  `android-login.sh admin 5179 dos.admin ""` and `ios-login.mjs 5179 dos.admin admin console`.
- Per-record mutations on :3007 and :3001 (`suspend`, `reactivate`, `users/{id}/disable`, `support-grants/{id}/approve|revoke`)
  act on the BODY `id`, not the path (DOS-112): send `id` = the target id or you get 500/404.
- Support pass: `POST /auth/platform/support-pass {grantId}` → `pass`; send as `x-support-grant: <pass>` with the console token on
  the distributor's own service (:3001). Lives 5 min.
- Fixture repair done by SQL in dos_qa after the probes: `update users set status='active' where username in ('dos.admin','qa.probe.owner')`.
  The probe tenant `qa-probe-support` stays (no delete in the product).
- `timeout` does not exist on macOS; give the Bash tool its own timeout instead.
