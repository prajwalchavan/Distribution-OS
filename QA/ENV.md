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
