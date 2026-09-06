# Build log — where we are, what is next

## RESUME HERE (updated 2026-09-06 20:30 IST, session 3)

**FRONTEND SLICE 3 `manager-app` GATED AND GREEN (2026-09-06 20:30 IST) — web, Android and iOS.**
The independent pass ran the whole chain from the outside — `pnpm install` a no-op with the lockfile
unchanged, `turbo run lint typecheck build test --force` **20/20 tasks · @dos/ui 155 tests ·
@dos/api-client 63**, `format:check` clean in both workspaces, `docs:readme:check` clean,
`expo export --platform web` ✓, `tsc --noEmit` for the WEB and the NATIVE resolution ✓, and no
`react-native` / `react-dom` / `@dos/ui/web` / `@dos/ui/native` import in any app file — then walked
**all 21 screens of docs/23 §2.1** plus the AI-drafts tab and the frame screens at **1400 × 900 and
375 × 812** against the founder's own database, clicked every second-level chip and segment on every
route, and signed in as `meena.joshi` and `dinesh.patil` to prove the role boundary both ways.
`expo run:android` **BUILD SUCCESSFUL in 2m 21s**, installed on `Pixel_7_API_36`, signed in, and Today
/ Orders / Billing matched the browser with an empty console on a launcher launch. iOS was verified in
**Expo Go** on the iPhone 16 Pro simulator — the same three screens, the same figures.

**Seventeen defects found and fixed. Four hid a whole feature, and all four have one cause:**
`<Segments>` is 2–3 options by UX-00 §6.10 and the kit enforces it with `items.slice(0, 3)` — SILENTLY.

1. **M4 Purchase orders could not be opened.** The screen passed four views, so the fourth was dropped:
   `procurement.purchaseOrders.list` was fetched on every load, its register was fully built, and no
   sequence of clicks could reach it. It is a chip row now, like the registers screen's eight books.
2. **A gate-count finding could not be written off.** `discrepancies.resolve` decides "accepted,
   claimed, credited or written off" in the contract's own words; three were offered.
   `m4.resolveWrittenOff` was already sitting in the string table, unused.
3. **Four of the seven credit-note reasons were unreachable** — rate difference, scheme settlement,
   cancellation and other. The register one tab away shows an issued note whose reason IS "Rate
   difference". A credit note is a legal document; the wrong reason on it is not cosmetic.
4. **A beat broadcast could reach 3 of the pilot's 11 beats, with 3 of its 8 WhatsApp templates.** The
   rest of the round simply had no way to be messaged.

**Five more where the screen stated something untrue.**

5. **The billing desk contradicted itself in five words.** The header said "211+ left to bill" (orders
   plus the packs that went out unbilled) and the panel sixty pixels below said "200+ left to bill" for
   the first of those two lists alone. Each panel names what it counts now: "200+ confirmed orders",
   "11 packs already gone out".
6. **Every register footer printed a partial sum as the column total.** The billing queue's foot read
   "200+ · ₹13,28,937.00": the count admitted there were more rows, and the rupee figure beside it
   silently claimed to be the whole queue while being the first two hundred rows to the paisa.
   `pageTotal()` in `src/lib/ui.tsx` is the single rule now — a money or quantity total appears only
   when the whole set is on the page. The receipts register goes further and prints the SERVICE's own
   `totals` for the filter (₹11,74,387.89, not a page of it).
7. **`<ConnectionStrip>` said "Offline" whenever the server ANSWERED with a refusal.** `online` was
   "the header's query has no error", so signing in as a role manager-service does not serve painted
   "Offline since 7:15 pm" under four panels quoting a 403 delivered over a working connection. Only
   `ApiError.kind === 'network'` is offline now; with the service really suspended (`kill -STOP`) the
   strip still reads "Offline since …" and every panel says "No connection", with no stale numbers.
8. **Expired stock wore the same grey chip as stock good until 2027.** Six of the pilot's godown rows
   expired on 4 Sep and looked identical to a January 2027 batch — on the screen whose own filter is
   "near expiry". Brick once the date has passed, ochre inside thirty days.
9. **"What is due to be claimed" listed a period already claimed and SETTLED**, with nothing to say so.
   `claims.periods.list` answers `existingClaimId` / `existingStatus`; the panel dropped both.

**Eight smaller ones.** The devices list printed the raw user agent ("Mozilla/5.0 (Macintosh; Intel Mac
OS X 10_15_7) AppleWebKit/537.36 …") once per sign-in, pushing the rest of the register off the screen
— it reads "Chrome on Mac" / "Unnamed device" now. Every gate-count row read "Not numbered yet · Godown
· 5 Sep, 10:32 pm", fifty of them, on a phone, at a lorry — now "Against bill DOCS/26-27/0242 · Alan's
Food Products — Bhiwandi". The team chart's caption printed ISO dates (`2026-08-08 — 2026-09-06`), and
the leaderboard beside it silently ignored the 7/30/90 control it sits under (it is a TARGET period,
and says so now). The order queue promised the accountant "1 confirm · 2 cancel" for keys bound behind
a permission she does not have. Four screens drew the filter summary TWICE, with two Clear buttons that
did different things. The inbound register's Source column read "Docint"; the export register read
"Report gst sales register csv" beside "Tally XML" and "Outstanding (Excel)". A price list with no start
date drew a bare "—" as its caption, and its rate column carried a meaningless total of twenty-nine
per-piece rates.

**Four in the shared kit, each with a test.** `sync-fonts.mjs` resolved one directory too high, so the
app warned "no design-system fonts …; the app will use the platform face" on every `web` and `build` —
the walk from `owner-app` is now in **`frontend/libs/app-template`** as well, so sales, warehouse,
delivery, retailer and admin are born correct. Chart axis ticks and bar labels were hard-coded 12 px
against the 14 px floor of UX-00 §4.3 (`chart.labelSize`), and `<CompareBars>` labels overprinted each
other into an unreadable band (`fitLabel`, four tests). The register's "Clear" was a 24 px button in a
13 px face, under both floors. The phone "More" sheet grew upward past the notch — measured on the
iPhone 16 Pro, its heading printed straight through the 8:15 clock and Sign out was unreachable — so
`<Sheet>` is capped at 86 % and its body scrolls (two source-reading tests).

**Carried, for the founder, not blocking.**
(1) **`owner-app` has the same silent `<Segments>` overflow in FIVE places** — `app/prices/index.tsx:233`,
`app/settings/index.tsx:248`, `app/staff/index.tsx:134`, `app/stock/catalog.tsx:143`,
`app/stock/inbound.tsx:143` — each passing four items where three are drawn. Not this gate's app; worth
a sweep before the next slice, and worth making the kit refuse rather than slice.
(2) **API gaps recorded rather than worked around**: `orders.list` and `billing.invoices.queue` carry no
`totals` (which is why those two footers now print no money at all), and `procurement.grns.list` carries
no supplier-invoice number, so the gate screen joins `supplierInvoices.list` and a receipt opened
against a bill older than that page still reads "Not numbered yet".
(3) `reporting.dashboard.owner` is a rolled-up snapshot: its "today" was 5 Sep at 10:45 pm while the
collections register beside it answers for 6 Sep. Both carry their date now; the two-day gap is the
backend's.
(4) The native typeface is still the platform UI face (UX-00 §4.1 defers registering the four TTFs
through `expo-font` to the first FIELD app's gate).
(5) **`expo run:ios` still cannot link on this Mac.** Xcode 16.2 ships only the **iOS 18.2** simulator
SDK (`xcodebuild -showsdks`: `Simulator - iOS 18.2`) and this machine has only the **iOS 18.0** runtime
(`simctl list runtimes`). Environment, not code. iOS is verified through Expo Go, which runs the same JS
bundle in a native shell.
(6) Seen ONCE, on the dev client's own deep-link launch (`dos-manager://expo-development-client/?url=…`)
and never on a launcher launch: "Can't perform a React state update on a component that hasn't mounted
yet", inside `expo-router/build/fork/useLinking.native.js:127`. No app frame in the stack.

**Local links.** Manager app <http://127.0.0.1:5174> (`pnpm --filter @dos/manager-app web` in
`frontend/`), manager-service <http://127.0.0.1:3002/docs>, auth-service :3000. Sign in **`vikas.kadam`**
/ `Dos@1234` (manager) or **`meena.joshi`** / `Dos@1234` (accountant — the same app, nine rail
destinations instead of eleven).

**NEXT: the sales app** (`frontend/sales-app`, docs/23 §3) — `pnpm --filter @dos/app-template new sales
5175`, then `pnpm docs:readme` in `backend/` in the SAME turn. It is the first FIELD app: offline before
the pilot (docs/23 §3.4), the 69 dp touch floor, and the first gate that must register the four TTFs.

---

## Previously (updated 2026-09-06 17:05 IST, session 3)

**FRONTEND SLICE 2 `owner-app` RE-GATED — AND RUNNING ON iOS AND ANDROID (2026-09-06 17:05 IST).**
The second, independent pass ran the whole chain from the outside — `pnpm install` a no-op with an
unchanged lockfile, `turbo run lint typecheck build test --force` **17/17 tasks · @dos/ui 140 tests ·
@dos/api-client 63**, `format:check` clean in both workspaces, `docs:readme:check` clean,
`expo export --platform web` ✓, `tsc --noEmit` for the WEB and the NATIVE resolution ✓, and no
`react-native` / `react-dom` / `@dos/ui/web` / `@dos/ui/native` import in any app file — then walked all
**26 screens of docs/23 §1.1 AND every second-level tab on them** at 1400 × 900 and at 375 × 812
against the founder's own database, and signed in as `vikas.kadam` to prove the role boundary.

**`expo run:android` now BUILDS AND RUNS** — the previous gate recorded it blocked. The blocker was
Android Studio's bundled **JDK 25**, on which AGP turns prefab's `WARNING: A restricted method in
java.lang.System has been called` into a build failure. A **JDK 17** was already on this machine,
downloaded by Gradle's own toolchain support at
`~/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.20.1+1/Contents/Home`; with `JAVA_HOME`
pointed at it, `BUILD SUCCESSFUL in 22m 47s`, the APK installed on `Pixel_7_API_36`, and the app was
driven by hand — fresh install → sign in as `sunil.tarsun` → Today, Money and Orders, all three
matching the browser, **with an empty Metro console**. `adb reverse tcp:3000 tcp:3000` and
`tcp:3001 tcp:3001` are what let the emulator reach the services on `127.0.0.1`.
**iOS was verified through Expo Go** on the iPhone 16 Pro / iOS 18.0 simulator — the same three
screens, the same figures. `pod install` now succeeds too (it needed `LANG=en_US.UTF-8`; without it
CocoaPods dies on `Encoding::CompatibilityError`), but `xcodebuild` still has **no eligible
destination** (see the carried list).

**Twelve real defects the gate found and fixed, each with a test or a measurement that fails without it.**

1. **A service that accepted the connection and never answered left every screen on a skeleton for
   ever, under a strip that said "Updated just now".** `fetch` has no timeout, so the realistic dead
   spot — the socket opens, no reply comes — was indistinguishable from a slow read. Measured with
   owner-service suspended (`kill -STOP`): **40 s of skeletons and "Updated just now"**, and the OS
   TCP timeout is minutes. `@dos/api-client` now gives every request a 20 s deadline
   (`requestTimeoutMs`, combined with the caller's own signal, the link's `redirect: 'manual'` kept),
   and `<ConnectionStrip>` — the component whose whole job is the honesty contract — no longer reads
   "Updated just now" when it has never had a read: it says **"Not updated yet"** with a grey dot.
   Measured after: at 20 s every panel says "No connection. This will send when the signal is back."
   and the strip says "Offline since 3:30 pm". Five tests.
2. **The header search promised three things and did one.** The box says "Search shops, bills,
   orders"; it read `retailers.list` alone, so an order number off this app's own register
   (**SO-0220**) answered "Nothing matches". `orders.list` and `billing.invoices.list` both take a
   `q` that matches the document number, so the search now reads all three, groups the results, and
   lands each on the register that holds it with `?q=` applied — **across every date**, because the
   person holding the paper does not know which month the register is showing. The shops page's own
   filter stopped calling itself by the header's name (two identically-labelled search boxes on one
   screen).
3. **The Growth screen drew ratios on a rupee axis.** `reporting.series.*` returns series in three
   units and the screen put them on one y axis: `stockTurns` (0.89) was a **dead-flat line at exactly
   ₹0.00 across twelve months** on a ₹0–₹6L scale, and `onTimeRate` / `podCoverageRate` were pinned to
   the floor of a 0–8 stop scale, four of the five delivery lines sharing one colour. Each unit has its
   own chart now — stops, then "On time and proof of delivery" in %, then "Stock turns" as a multiple
   (`0.9×`, not `89%`), then "Stock cover" in rupees.
4. **The schemes register printed basis points and paise as bare integers.** The pilot's own scheme
   "2% off on bills over ₹5,000" read **`value ≥ 500000 inr` / `order_pct 200`** — a threshold a
   hundred times too big beside a discount a hundred times too big, on the most price-sensitive screen
   in the app. `triggerMin` is paise when the unit is `inr`, `rewardValue` is bps for the three `_pct`
   kinds (the contract says so in as many words), so the row now reads
   "Order value ≥ ₹5,000.00 · Off the bill: 2% · Us".
5. **Seven more registers still printed the database's own words**, on tabs the first pass never
   opened: the stock ledger (`transfer_out`, `load_sheet`, `expiry_writeoff`), the day book
   (`trip_settlement`, `claim_write_off`), numbering series (`server` / `external`, under a head
   borrowed from the SCHEME editor — "Trigger"), feature flags (`van_sales`, `e_invoicing`), the
   support-access scope (`read_only`), the message templates (`delivery_today` — worded on the tab
   beside it and raw here), the incentive metrics (`value`, `collections`) and the shop panel's credit
   mode (`stop`). ~40 new `word.*` keys. A **crawler that clicks every segmented control on every route
   and greps the rendered text for snake_case and camelCase** is what found them, and now reports
   **all clean** except two explained cases (see below).
6. **A 21 dp tap target on a 63 dp phone.** `<Link variant="text">` — Today's "Open the rows behind
   this" — had no floor on web, and the native half had the condition **inverted**, giving the floor to
   `plain` (which wraps something already sized) and nothing to `text`. Both renderers now carry
   `theme.touchSize`. Measured 63 dp on the phone, 32 px on the laptop. Four tests.
7. **The templates register headed a Language column "State code"** — which in this product means the
   GST state code, 27 for Maharashtra. It read "State code: en-IN".
8. **"Needs you (0)" over a panel reporting a failure.** With the service refusing, the heading stated
   a count the app did not have, contradicting its own body. It states the count only when a read has
   answered.
9. **Two smaller ones**: the approvals side panel printed the note field's own label a second time as
   the reject button's "reason" (now a sentence that says what to do), and `<Register>`'s filter
   summary read "1 filters" (now "Filters (1)").

**Three more the phones found, all of them invisible on the web.** The screen header lays its chips and
its actions out in a `flexWrap: 'wrap'` row, which sizes a child to its CONTENT — and a React Native
child that expects the parent to give it a width collapses silently.

10. **The whole level-2 tab row was missing on every phone.** `<Tabs>` on native is a row of `flex: 1`
    children with no intrinsic width, so "Today · Approvals · Live map" rendered as an **empty 63 dp
    band**. The web half already carries `width: '100%'` with a comment about exactly this; the native
    half never got it. A navigation level, gone, in all seven apps.
11. **The 7 / 30 / 90-day segmented control rendered as an empty 2 px pill** on every phone, same
    cause: `flex: 1` per option instead of the web half's `padding: 0 space[4]`. It is on Orders,
    Money, Billing, Trips and the day book.
12. **Every launch and every sign-in logged a React error on a phone**: "Can't perform a React state
    update on a component that hasn't mounted yet", naming expo-router's own `<ContextNavigator/>`.
    The root layout's redirect fires from an effect, which on the web lands in the same tick as the
    navigator's mount and on a phone does not. It waits for `useRootNavigationState()` to have a `key`
    now — fixed in `owner-app` AND in `frontend/libs/app-template`, which every later app is generated
    from. Measured after: a fresh install, a sign-in and three screens with **nothing in the console**.

Both native layout defects are guarded by source-reading tests in `parity.test.ts` (`@dos/ui/native`
cannot be imported in Node, which is why that file reads sources rather than rendering).

**Carried, not blocking, for the founder.**
(1) **Backend: a journal narration carries a machine word.** `claims` writes
`"CLM-0195 settled by Alan's Food Products — Bhiwandi (credit_note DOCS/CN/0190)"`, and the day book
shows narrations verbatim (they are the accountant's own sentence). The word `credit_note` inside it
is the service's, not the screen's — a one-word change in `claims`.
(2) `registers.schemeSpend` still answers `schemeName = <uuid>` for a line whose `applied_rules` names
a RULE id with no scheme row; the Profit screen prints "Scheme 2451691c".
(3) `tenantCatalog.costs` rows carry no variant name; `orders.approvals.list` gives `requestedBy` as an
id that `tenancy.staff.list` does not always contain (smoke users).
(4) The MRP on every seeded stock lot is ₹20.00 and Campa Cola 200 ml lists at ₹100.00 — demo data,
confirmed against `GET /inventory/balances`, not a formatting bug.
(5) The message-template bodies show `{{deliveryDate}}` and friends: that is the template's own source
text, which is what the editor must show.
(6) **`expo run:ios` (a dev build) still cannot link on this Mac.** `expo prebuild` and `pod install`
both succeed now, but `xcodebuild -showdestinations` lists **zero eligible destinations**:
`{ platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device,`
`error:iOS 18.2 is not installed. To use with Xcode, first download and install the platform }`.
Xcode 16.2 ships the iOS 18.2 SDK and this Mac has only the iOS **18.0** simulator runtime, which it
will not accept. The gate tried to fix it: `xcodebuild -downloadPlatform iOS` fails twice with
**"Finding content...Unable to connect to simulator." (exit 70)**, with the simulators booted and
shut down alike — the platform has to be fetched from Xcode's own Settings › Platforms, signed in.
Until then iOS is verified through **Expo Go**, which runs the same JS bundle in a native shell.
(7) **The native typeface is still the platform UI face** (Roboto on Android, SF on iOS): the four TTFs
are in `libs/ui/assets/fonts` but no `expo-font` plugin entry registers them, and UX-00 §4.1 defers
that to the first FIELD app's gate on purpose.
(8) Seen ONCE, on the very first bundle load of the Android dev build and again after each Fast
Refresh, never on a clean or fresh launch: `RangeError: Maximum call stack size exceeded (native stack
depth)` inside `@orpc/client`'s recursive Proxy (`index.mjs:73`), followed by React's "Should not
already be working." A fresh install (`pm clear`) plus sign-in plus three screens is clean, so it is
recorded rather than chased.

**Local links.** Owner app <http://127.0.0.1:5173> (`pnpm --filter @dos/owner-app web` in `frontend/`),
owner-service <http://127.0.0.1:3001/docs>, auth-service :3000. Sign in `sunil.tarsun` / `Dos@1234`
(manager `vikas.kadam`, accountant `meena.joshi`, warehouse `dinesh.patil`, salesperson
`rahul.deshmukh`, delivery `ganesh.more`, retailer `ramesh.gupta` — every password `Dos@1234`).
Android: `JAVA_HOME=~/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.20.1+1/Contents/Home`,
`adb reverse tcp:3000 tcp:3000 && adb reverse tcp:3001 tcp:3001`, then `npx expo run:android`.
iOS: `LANG=en_US.UTF-8 npx expo run:ios` once the iOS platform is downloaded; Expo Go until then.

**NEXT: the manager app** (`frontend/manager-app`, docs/23 §2) — `pnpm --filter @dos/app-template new
manager 5174`, then `pnpm docs:readme` in `backend/` in the SAME turn.

---

**FRONTEND SLICE 1 `universal` RE-GATED AND GREEN (2026-09-06 13:45 IST) — now on iOS _and_ Android.**
The second independent pass ran the whole chain from the outside (`pnpm install` a no-op with an
unchanged lockfile, `turbo run lint typecheck build test --force` **17/17 tasks · @dos/ui 111 tests ·
@dos/api-client 52**, `format:check` clean, `expo export --platform web` ✓, `tsc --noEmit` for the WEB
and the NATIVE resolution ✓, no `react-native` / `react-dom` / `@dos/ui/web` / `@dos/ui/native` import in
any app file), walked `frontend/libs/app-template` at **1400 × 900 and 375 × 812** in a real browser, and
ran the SAME codebase on the **iPhone 16 Pro simulator** and the **Pixel 7 / API 36 Android emulator** —
sign in, Today, Settings, the "More" sheet — with a clean console and no non-2xx other than the
deliberate 403 of the role-boundary probe.

**Seven real defects found and fixed, each with a test or a measurement that fails without the fix.**

1. **Switching distributor left the screen empty and never asked the server.** `useQuery` decided
   "refetch me" from `entry.updatedAt === 0` as a BOOLEAN — but a read that FAILED also leaves
   `updatedAt` at 0, so after a 403 the flag was already true and `cache.clear()` (switch distributor,
   sign out) and `cache.invalidate()` (after a write) changed nothing a `useEffect` could depend on.
   Measured with `ramesh.gupta`, who buys from three distributors: switch → four em-dashes, **zero
   requests in flight**. `QueryEntry` now carries a `generation` that only goes up; `clear()` /
   `invalidate()` bump it and ABANDON anything in flight, so the previous distributor's answer can no
   longer land on the next distributor's screen either. Four tests (`cache.test.ts`).
2. **The desk rail was 172 px and its tenant switcher was 185 px.** For any user with more than one
   membership — a shopkeeper's normal case — the `▾` was painted 14 px OUTSIDE the rail, on the page.
   Root cause in `<TenantLogo>`: `whiteSpace: nowrap` with nothing to shrink, where the native half had
   used `numberOfLines={1}` all along. Web now clamps to one line (full name on `title`) and the button
   is sized by its column. Measured: switcher right edge **159 px** inside a 172 px rail.
3. **Every menu row in the kit was Apple's 44 pt** — the phone "More" sheet and the account and
   distributor menus — while UX-00 §5.2 says in one sentence that 44 pt "is below the floor and is not
   our minimum". Native read `touchSize`; web hard-coded 44. Measured after the fix: **63 dp** on a
   phone (owner/manager), **32 px** on the laptop the same app opens on. Four tests.
4. **A bottom sheet closed with a 32 px desk button.** `<Sheet>` passed `size="desk"` whatever it was
   rendering. It is the desk size only for the desk SIDE PANEL now; on a sheet it is the app's floor.
   Measured 63 dp on the phone shell, 76 dp for a warehouse theme. One test.
5. **`<Register>` dropped `totals` and `onClearFilters` on native.** The web half draws a `<tfoot>` and
   a one-tap clear; the phone half rendered neither, so the figure a register exists for — what the
   column adds up to — never reached a phone, and a contract prop did nothing. Both implemented; the
   web clear-filters button also stopped being 24 px on a phone. Found by a mechanical prop-coverage
   sweep of `types.ts` against both renderers (the only other difference is `Button.shortcut`, which is
   a desk keyboard affordance and correctly ignored on native).
6. **The kit's own style guide logged four font errors per load and rendered in the wrong typeface.**
   `pnpm --filter @dos/ui gallery` served nothing at `/fonts`, so the four `@font-face` requests got
   `index.html` back → `OTS parsing error: invalid sfntVersion` ×4. `publicDir` now points at
   `libs/ui/assets`, and the page's only other console entry (a favicon 404) is gone too.
7. **X2 of docs/23 §0 did not exist.** A staff account is created with a TEMPORARY password
   (`tenancy.staff.create` and the platform console both set `must_change_password`) and the services
   report the flag but do not enforce it — so anyone given a password by their manager used the app
   with it indefinitely, in all seven apps. `app/change-password.tsx` plus a gate in the shared
   `app/_layout.tsx`: until the flag clears, every route (deep links included) lands on that screen and
   no chrome renders. Proved end to end against the founder's own database with the flag really set on
   `sunil.tarsun`, then restored.

Also fixed: `pnpm format` was rewriting the 86 MB generated `android/` tree (`.prettierignore` now
covers `*/ios` and `*/android`), and the template's `app.json` carried `edgeToEdgeEnabled`, which Expo
SDK 57 prints a deprecation warning for on every prebuild.

**Carried, not blocking, for the founder.**
(1) **`expo run:ios` (a dev build) still cannot link on this Mac** — `expo prebuild` and `pod install`
now succeed with Xcode 16.2, but `xcodebuild` reports **"iOS 18.2 is not installed. To use with Xcode,
first download and install the platform"** and offers NO eligible destination: the iOS 18.2 simulator
runtime was never downloaded and the leftover 18.0 runtime is not registered for Xcode 16.2. Fix with
`xcodebuild -downloadPlatform iOS` (multi-GB) — the gate does not download SDKs. iOS was verified
through **Expo Go** instead, on the iPhone 16 Pro / iOS 18.0 simulator.
(2) **`expo run:android` (a dev build) fails on the JDK.** Android Studio's bundled JBR here is
**JDK 25**; AGP runs `prefab` as a subprocess and turns any stderr line into an error, and on JDK 25
prefab prints `WARNING: A restricted method in java.lang.System has been called` →
`Execution failed for task ':react-native-worklets:configureCMakeDebug[arm64-v8a]'`. AGP supports
JDK 17/21. Install a JDK 17 or 21 and point `JAVA_HOME` at it. Android was verified through **Expo Go**
on `Pixel_7_API_36` instead, with `adb reverse tcp:3000/3001` so the emulator reaches the services.
(3) **The native typeface is still the platform UI face** (`fontFamily.native` is `null`): the four TTFs
are in `libs/ui/assets/fonts` but no `expo-font` plugin entry registers them. UX-00 §4.1 defers this to
the first FIELD app's gate on purpose (an unresolved family name silently breaks `fontWeight` on
Android), so it is not a defect of this slice.
(4) `frontend/owner-app/app.json` still carries the same stale `edgeToEdgeEnabled` key the template shed
— a one-line deletion for the owner slice.
(5) Still no `<ConnectionStrip>` in the TEMPLATE (`owner-app` wires one from a query's `updatedAt`);
the honesty contract is carried by the error state, verified with the services blocked: "No connection.
This will send when the signal is back.", the session survives a full reload, and the numbers come back
when the services do.
(6) X4 of docs/23 §0 (**Profile & devices** — `auth.sessions` / `auth.revokeSession`) is still unbuilt
in the template; its `/settings` says so and defers to the role app.

**NEXT: finish the owner app** (`frontend/owner-app`, docs/23 §1), which is mid-slice — its screens are
partially built on the kit as it stands and it inherits every fix above.

---

**FRONTEND SLICE 1 `universal` first pass — the independent gate ran and was GREEN (2026-09-06 11:20 IST).**
The universal `@dos/ui` layer, `@dos/api-client` and `frontend/libs/app-template` were verified from the
outside: `pnpm install` a no-op with an unchanged lockfile, `turbo run lint typecheck build test --force`
**14/14 tasks · @dos/ui 98 tests · @dos/api-client 48**, `format:check` clean in both workspaces,
`docs:readme:check` clean, `expo export --platform web` succeeds, `tsc --noEmit` succeeds for the WEB and
(with `customConditions: ["react-native"]`) the NATIVE resolution, and `grep` finds no `react-native` /
`react-dom` / `@dos/ui/web` / `@dos/ui/native` import in any app file. The template was walked signed in as
`sunil.tarsun` / `Dos@1234` against owner-service :3001 **at 1400 px, at 1024 px, at 1120 px and at
375 × 812** in a real browser, and **on the iOS simulator (iPhone 16 Pro, iOS 18, Expo Go SDK 57)** — sign
in, Today, Settings — with a clean console and **zero non-2xx requests** other than the deliberate 403 of
the role-boundary probe.

**Nine real defects the gate found and fixed, each with a test or a screenshot that fails without the fix.**

1. **A lost signal signed the user out, permanently.** `refreshNow()` in `@dos/api-client` called
   `session.clear()` on ANY refresh failure — including a `TypeError` from `fetch` — so opening the app in a
   dead spot wiped the refresh token and demanded a password the driver cannot verify offline (UX-00 §12:
   "the session survives a phone call and a day without signal"). Measured: services blocked + reload → the
   **Sign in screen**. Now only a 401 ends a session; anything else keeps it and the screens say "No
   connection". Three tests (`client.test.ts`), plus `honesty-12-service-down-reload.png`.
2. **Every 4xx read as a machine word.** The service answers
   `{"message":"owner-service does not serve the retailer role","error":"Forbidden"}` and the app printed
   **"Forbidden"**: `toApiError`'s own guard compared the message to the code case-SENSITIVELY
   (`"Forbidden" !== "FORBIDDEN"`) and never looked at the body. It now prefers the service's own sentence
   and treats a code-word message as absent in any case. Three tests (`errors.test.ts`).
3. **Opening `/sign-in` with a live session hung forever on the skeleton.** `app/_layout.tsx` returned
   `<Redirect>` INSTEAD of `<Slot />`, so the navigator the redirect needs was never mounted, `usePathname()`
   never changed and React threw _Maximum update depth exceeded_ — a blank page a bookmark could reach. The
   redirect is imperative now and the slot is always rendered.
4. **The self-hosted typeface was a claim, not a fact.** `@font-face` pointed at
   `/fonts/IBMPlexSans-Variable.woff2`, which is not in this repo; an Expo web server answers an unknown path
   with `index.html`, so every page of every app logged `OTS parsing error: invalid sfntVersion` (= `<!DO`).
   On native `fontFamily: 'IBMPlexSans'` named a family nothing registers, which on Android stops `fontWeight`
   working. `FONT_URL` / `fontFamily.native` are `null` until the binaries land, with the exact step written
   beside them. **The binaries are still to be installed — see "Carried" below.**
5. **The desk header's account menu was stranded mid-header** (`maxWidth: 420` on the flex spacer, not on the
   search box), 620 px from the left edge of a 1400 px header. Right-aligned now; measured gap 20 px.
6. **The rail never collapsed.** `viewport.railCollapsed` was computed by both renderers, passed to
   `DeskShell`, and never read — UX-00 §8.1 "collapses to 56 px icons below 1100 px". Implemented on both
   renderers (icon, else the label's initial, with the word on `title`/`aria-label`); measured 56 px at
   1024 and 172 px at 1120.
7. **A phone got desk sizes.** The touch floor and the density were fixed per APP while the shell is chosen
   per VIEWPORT — so an owner on a laptop got 63 dp buttons and an owner on a 375 px phone got 14 px body
   text and a real `<table>` (UX-00 §2 "16 sp body … never a table", §5.2 "buttons 32 px" on desk). Both now
   follow the viewport in `buildTheme`, `field`/`floor` never shrinking. Seven tests (`theme.test.ts`).
8. **iOS ate the notch twice.** `<Screen>` added `insets.top` inside `AppShell`'s phone shell, which had
   already spent it — a 59 pt empty band above every title on an iPhone 16 Pro. Native: the shell publishes
   spent insets through `SafeAreaInsetsContext`; web: `--dos-inset-top` / `--dos-inset-bottom`.
9. **iOS capitalised the username.** `sunil.tarsun` typed on the simulator arrived as `Sunil.tarsun` and the
   sign-in failed with the right password. `TextInputProps.capitalize` defaults to `none`, with autocorrect
   and spell-check off on both renderers — a username, a GSTIN, an HSN or an invoice number is not a
   sentence. Two tests + the simulator screenshot.

Also wired: **permissions on the device** (docs/08 §0) — `app/_layout.tsx` computes `AppShell.can` from
`PERMISSIONS`/`isAllowed` in the linked `@dos/contracts`, so the rail hides what the matrix refuses. Proved
with a real token: `ramesh.gupta` (retailer) signed into the owner app sees **Today only**, no Settings
(`tenancy.settings.get` is STAFF), and the screen says the service's own sentence. Two React DOM warnings
(a padding shorthand/longhand mix, a non-inheriting row font) were cleared on the way.

**Carried, not blocking, for the founder.**
(1) **The IBM Plex Sans binaries are not in the repo** and the gate did not fetch them (downloading
third-party files is not a gate's call). Both apps render in the platform UI face at the same sizes. To turn
the typeface on: `IBMPlexSans[wdth,wght].woff2` into the app's `public/fonts/` + `FONT_URL` in
`libs/ui/src/web/css.ts`; the four static TTFs through the `expo-font` plugin + `fontFamily.native` in
`libs/ui/src/tokens.ts` (UX-00 §4.1, OFL-1.1).
(2) **`expo run:ios` (a dev build) cannot be built on this Mac**: React Native 0.86.3 requires **Xcode ≥ 16.1**
and this machine has **16.0** — `pod install` fails with "Invalid `Podfile` file: Please upgrade XCode".
That is an environment blocker, not a code one; the app was verified on the simulator through **Expo Go**
instead. Android was not built here (no Android SDK) and is not claimed.
(3) **No `<ConnectionStrip>` is wired yet** — `AppShell` places one and `useQuery` already returns
`updatedAt`, but `@dos/offline` is still only types, so there is no `online` source. The honesty contract is
carried by the error state today ("No connection. This will send when the signal is back.").
(4) Chrome logs a verbose hint that the sign-in password field is not inside a `<form>`; a screen cannot
render one (the kit owns the DOM), so a `form` affordance belongs in the kit if password managers matter.
(5) auth-service answers a bad username with **"Input validation failed"** — the app now shows the service's
own sentence, so that wording is worth softening on the BACKEND side.

**NEXT: the owner app** — `pnpm --filter @dos/app-template new owner 5173`, then `pnpm docs:readme` in
`backend/` in the SAME turn (the backend generator owns `frontend/owner-app/README.md`), then docs/23 §1.

---

**MODULE `ai + platform-admin + demo (full backend)` IS DONE — the independent gate ran and is GREEN
(2026-09-06 08:05 IST). THE BACKEND IS COMPLETE.** The three-distributor demo slice (row below the
`sync-runtime` row) was verified end to end against the founder's own database: `turbo run build
typecheck lint test --force` **56/56 tasks, 2381 tests**, `turbo run test --force` **2381 again**,
`docs:readme:check` + `format:check` clean in both workspaces, frontend `lint`/`typecheck`/`build`
12/12, `pnpm db:migrate` a no-op at **43 migrations**, **`pnpm smoke` 1588 · 0 BROKEN →
`--destructive` 1588 · 0 BROKEN → `db:seed` → `pnpm smoke` 1588 · 0 BROKEN** on all eight services,
and `pnpm db:seed` twice with **identical row counts across all 139 tables**. Every claim in the
slice was checked with real tokens against Sai Distributors and Kalyan Agencies as well as the
pilot: drafts in all six statuses per distributor, a confirmed draft whose lines equal its own
order's lines variant for variant, 20 of 29 / 13 of 26 / 13 of 24 SKUs below cover, an unapplied
route plan per plannable trip, a rep 403 on the forecast list, and no money-shaped field anywhere on
a reorder row.

**The one real defect the gate found and fixed, with two tests that fail without the fix.**
`modules/ai` built a SKU's display name as `brand || ' ' || product || ' ' || variant` in THREE
queries (`ai.mappers.variantLabels` and both label queries in `matcher.ts`). The curated catalog
repeats itself on purpose — brand `Campa`, product `Campa Cola`, variant `Campa Cola 1 L` — so
**all 29 of the pilot's listed SKUs** reached the godown's reorder list, the draft review screen and
the language model's own candidate list as "Campa Campa Cola Campa Cola 1 L". The sibling slice had
written `composeLabel()` in `seed-demo/ai.ts` for exactly this reason and fixed only the SEED, so a
seeded draft stored one name and the API rendered another for the same variant. One shared
`variantLabelSql` in `modules/ai/ai.internals.ts` now prepends each part only when the name does not
already begin with it, and all three queries use it; a brand the product name does not carry
(`MOM Makhana` before `MOM Roasted Makhana Peri Peri 60 g`) is still kept. pg_trgm collapses
duplicate trigrams, so **no match ever moved** — only the reading of the guess was wrong.

**Carried, not blocking, for the founder to decide.** (1) **The forecast demand source differs
between the seed and the live pass.** `runForecastPass` reads `stock_ledger` rows with
`reason = 'sale'`; the seed reads this distributor's own served `sales_order_lines`. The seeded
month records movement only as load-sheet transfers godown → vehicle and never posts the pack-time
`sale` row `warehouse.packs.confirm` writes, so pressing `ai.forecast.run` today overwrites the
seeded numbers with much smaller ones (and on a fresh database the ledger alone yields `new_sku` for
~25 of 29 SKUs and ZERO below-cover rows). The real fix is for the demo's dispatched orders to post
their pack-time sale rows, which also depletes `stock_balances` by tens of thousands of pieces and
could starve `pnpm smoke`'s pack and reserve probes — a seed-wide change, not a gate change.
(2) **A single `pnpm smoke` closes the pilot's seeded PENDING support request and `pnpm db:seed`
cannot bring it back**: owner-service approves it during the run, `--destructive` then revokes it,
and migration 0036 makes both final ("an approval is revoked, never un-done"). `restoreDemoAccess()`
therefore cannot restore it the way it restores the tenant, the memberships and the users; the
database's own answer is "ask again", which means DELETING the demo row and filing it afresh — a
demo-policy decision on a decision table, so the gate left it. Sai and Kalyan still have theirs.
Same row ages out four hours after any seed (`requestedAt = new Date()`, `onConflictDoNothing`).
(3) **On a cold database the pilot has only one plannable trip**: `seedDeliveryRoad` builds
TRIP-NEXT from bills already packed or dispatched and not yet on a trip, of which a first seed has
none, so TRIP-NEXT gets no stops and no plan. On the founder's database both TRIP-ACTIVE and
TRIP-NEXT have one; TRIP-ACTIVE's covers a single open stop at 0 m (honest, thin), and the rich
six-stop 6.6 km plan is TRIP-NEXT's and pilot-only — Sai and Kalyan get a one-stop plan each.
(4) `docs/plans/00-coordination.md` still predates modules 12, 13 and 14: §2, §4, §6 and §8 name
neither `ai` nor `admin` nor `sync-runtime`.

**NEXT: the six apps, starting with the owner app on layout A Ledger.** The universal kit layer and the
app template they are generated from are DONE — see the frontend slice below.

---

## FRONTEND SLICE 1 — the UNIVERSAL layer and the app template (2026-09-06)

**`@dos/ui` is now the universal layer of docs/08 §0, and `frontend/libs/app-template` is a running Expo
app the other seven are generated from.** Verified end to end: a throwaway `hello-app` generated from the
template signed in as `sunil.tarsun` / `Dos@1234` against owner-service :3001 and drew `KpiStrip` +
`Register` + `Button` from live `tenancy.me` and `tenancy.branding.get` — in a browser at 1400 px and
1024 px (the UX-00 §8.1 rail), at 390 px (the §8.2 bottom tabs), and **on the iOS simulator from the same
files** (Expo Go, SDK 57). `hello-app` was then deleted.

**The Expo baseline the SDK decided** (from `expo@57.0.20`'s own `bundledNativeModules.json`, now the
catalog in `frontend/pnpm-workspace.yaml` — never bump one of these by hand):

|                                               |                                    |
| --------------------------------------------- | ---------------------------------- |
| **Expo SDK**                                  | **57.0.20** (current stable)       |
| **React Native**                              | **0.86.3** (New Architecture only) |
| **React / React DOM**                         | **19.2.3**                         |
| react-native-web                              | 0.21.2                             |
| expo-router                                   | 57.0.19                            |
| safe-area-context · screens · gesture-handler | 5.7.0 · 4.26.0 · 2.32.0            |
| react-native-svg                              | 15.15.4                            |
| babel-preset-expo · @babel/core               | 57.0.10 · 7.29.7                   |
| TypeScript                                    | 6.0.3 (unchanged)                  |

`@tanstack/react-query` left the catalog (docs/08 §0: "No TanStack Query"); `zod` and `@orpc/openapi`
joined it, because `@dos/contracts` is linked from `backend/libs` and imports them at runtime.

**What was built.** `src/index.web.ts` / `src/index.native.ts` (the `exports` conditions Metro swaps on;
the shared barrel is now `src/shared.ts`, see below) · the ten layout primitives on BOTH renderers
(`Screen`, `Box`, `Stack`, `Row`, `Scroll`, `List` — a windowed DOM list / `FlatList` —, `Pressable`,
`Img`, `Link`, `Txt`) with their prop types in `types.ts` · `AppShell` + `TenantSwitcher` + `useViewport()`
on both, desk rail at ≥ 1024 px and phone tabs below · `@dos/ui/platform` — storage, documents, camera,
location, files, haptics, share and **crypto**, each a `.web.ts` / `.native.ts` pair against one signature
in `platform/types.ts` · `@dos/config/eslint/app` (react-native / react-dom / `@dos/ui/web` /
`@dos/ui/native` and raw hex colours all unimportable, with messages pointing at docs/08 §0) ·
`libs/app-template` with `new <role> [port]` · `.claude/launch.json` entries `app-template` :5170 and
`<role>-app` :5173–:5179.

**Two parity guarantees, both executable.** `libs/ui/src/parity.test.ts` reads the two barrels (it cannot
import the native one in Node) and asserts name-for-name equality plus the platform pairs; `parity.types.ts`
binds every primitive on both renderers to the ONE contract, so a matching name with the wrong props fails
`pnpm typecheck`. Six web-only names are on a documented allow-list: the CSS generator has no native twin.

**Four real defects the proof found, each fixed.**

1. **A phone could not create a single row.** Hermes has no `crypto.getRandomValues`, `@dos/domain` is
   dependency-free by rule, and every row in this product carries a client-generated UUIDv7 — so `boot()`
   threw on the FIRST id. `@dos/ui/platform` now installs `expo-crypto`'s generator as a side effect of
   being imported, before any screen can ask.
2. **`@dos/api-client` crashed before its first request on a phone**: React Native has a `navigator` but no
   `userAgent` on it, and `client.ts` called `.slice` on it unguarded.
3. **A string in a `ReactNode` prop is legal on the web and fatal on native** — `KpiItem.value` threw "Text
   strings must be rendered within a `<Text>` component". Both `KpiStrip`s wrap it now, so `value` means the
   same thing on both renderers.
4. **Density was deciding layout, and can no longer**: the same `desk` app opens on a 390 px phone, where a
   four-column KPI strip put "Distributor" through a shredder. `useViewport()` (a `.web` / `.native` pair)
   is what `AppShell` and `KpiStrip` read now; the strip is 2×2 on a phone as UX-00 §8.2 draws it.

**Two structural things to know before the next slice.** Metro does NOT rewrite a `./thing.js` specifier to
`./thing.ts` the way `tsc` and Vite do, and this repo writes Node-style specifiers because the backend emits
real `.js` — so every app's `metro.config.js` carries a `resolveRequest` that tries the extensionless form
first, and the kit's shared barrel was renamed `src/index.ts` → **`src/shared.ts`** (resolving `./index`
from inside `index.web.ts` would find the platform variant, i.e. itself). And a generated app sits one
directory shallower than the template, so the generator rewrites every `link:` path; copied verbatim they
would point above the repo and every contract type would silently become `any`.

**`frontend/owner-app` (the Vite skeleton) was DELETED**, as the brief allowed: the owner slice regenerates
it from the template. `pnpm docs:readme` skips an app directory that does not exist, so `docs:readme:check`
stays green — but **the moment `frontend/<role>-app` exists again, the BACKEND's generator owns its
README** (`backend/tools/generate-readmes.mts` has an entry for all seven), so the next slice must run
`pnpm docs:readme` in `backend/` right after generating its app or the backend CI job fails on a stale
file. Verified both ways: generated `owner-app` → `docs:readme:check` reported it stale; deleted it →
green again. That generator's owner-app blurb still says "Web today (Vite)"; it is backend prose and was
left for the owner slice to correct.

**MODULE `sync-runtime` IS DONE — the independent gate ran and is GREEN (2026-09-06 07:05 IST).** The
delta-sync coverage + all-in-one slice (row 14 below) was verified end to end against the founder's own
database and is now correct: `turbo run build typecheck lint test --force` **56/56 tasks, 2378 tests**,
`turbo run test --force` **2378 again**, `docs:readme:check` + `format:check` clean in both workspaces,
frontend `lint`/`typecheck`/`build` green, `pnpm db:migrate` a no-op at **43 migrations**, and **`pnpm smoke`
1588 · 0 BROKEN → `--destructive` 1588 · 0 BROKEN → `db:seed` → `pnpm smoke` 1588 · 0 BROKEN**, with
`db:seed` twice giving identical counts across all 139 tables. The gate found and fixed **three real
defects, each with a test**: a shopkeeper's pull was reading every other customer's `retailer_links` and
every tier's price list (never-list 9 — 31 links with 12 of other shops, and all 7 rate cards, on the
founder's data; now 21 own links and 3 lists, the default plus its own tier); the shop's manifest
advertised three tables as `writable` while `sync.upload` is STAFF, which would have wedged the device
queue on a 403; and every paise column arrived as a JSON string while its own manifest said `integer`.
`examples.spec.ts` was also loading the whole doc-example context six times and timing out under the full
parallel build; it loads once now. **NEXT: the six apps, starting with the owner app on layout A Ledger.**

**MODULE 13 `platform-admin` IS DONE — the independent gate ran and is GREEN (2026-09-06 05:15 IST).
`admin-service` :3007 serves 15 `admin.*` procedures and is the only service that mounts the `admin` key;
the console sign-in (`/auth/platform/login` · `refresh` · `me`), the support pass
(`/auth/platform/support-pass`), the `x-support-grant` path into owner-service with a `platform_audit` row
per call, `dos.admin` / `Dos@1234` seeded, and a placeholder `frontend/admin-app`.
Backend: `turbo run build typecheck lint test --force` **52/52 tasks, 2350 tests**, twice; `docs:readme:check`
and `format:check` clean in both workspaces; frontend `lint`/`typecheck`/`build` green; `pnpm db:migrate` a
no-op at **43 migrations** and `db:generate` "No schema changes"; **`pnpm smoke` 1584 calls · 0 BROKEN and
`pnpm smoke --destructive` 1584 · 0 BROKEN THREE RUNS IN A ROW**; `pnpm db:seed` twice with identical counts
across all 139 tables. The support path was walked by hand with real tokens: the console asks, the console
is 403 when it tries to approve its own ask, the OWNER approves on :3001, the pass is minted, a read-only pass
reads `/retailers` · `/tenancy/settings` · `/reporting/dashboard/owner` and is 403 on a write and 403 on
admin-service — with a `support.read` audit row per call.
NEXT: the six apps, starting with the owner app on layout A Ledger.**

**DEMO DATA FOR THREE DISTRIBUTORS — AI, ROUTES AND THE CONSOLE (2026-09-06, sibling slice).** The
assistive surfaces and the platform console were seeded for the PILOT ONLY; they are v1 for every
distributor (docs/22 §8, 2026-09-04 and 2026-09-05), so `seed-demo/ai.ts` and the owner's half of
support access now run for all three, after the `full` block rather than inside it.

- **Drafts in every status, per distributor** (`ai_order_drafts`): `needs_review` (the shop's WhatsApp
  sentence with an AMBIGUOUS line and its candidates), `parsed` twice (a rep's typed chit and a voice
  note), **`confirmed` into a REAL order of that distributor** — `created_order_id` set, the reviewer
  and the review moment named, which is what migration 0032 refuses to let a parser do on its own —
  `rejected` (with the reason) and `expired` (nobody answered it). The lines of the confirmed draft are
  read back OUT OF THE ORDER, so the two say the same thing in the same pieces. No draft names a variant
  its distributor does not list: Kalyan Agencies carries no MOM Makhana and its voice note says so.
- **A reorder list with real cover** (`ai_forecasts`): demand is this distributor's OWN served order
  lines, pieces per IST business day and not a paisa anywhere (docs/22 §9 rule 1 is why the godown can
  read the list at all), through `estimateDemand()`'s own branches — Croston under a third of the days,
  moving average above it. **20 of 29 SKUs for Tarsun and 13 each for Sai and Kalyan are below the
  contract's default 21-day cover**, so `ai.forecast.list --belowCover` is a working list rather than an
  empty one. Read from the orders because the seeded month records its movement as load-sheet transfers
  and never posts the pack-time `sale` row the product itself writes; the rows are an UPSERT on
  `(tenant, variant, location, horizon)`, exactly as the worker's pass writes them.
- **One unapplied route plan per plannable trip** (`route_plans`), from the same `planRoute()` the API
  calls, over the same open stops and into the same slots — press "apply" and the stops move.
- **Console**: `dos.admin` (super) and `dos.support` unchanged; a subscription per distributor; support
  windows in all three states — one live and approved, one lapsed, and **a pending request against each
  of the three distributors**, so every owner app has a decision to take. `platform-user` and
  `platform-admin` became GLOBAL id kinds (`seed-demo/ids.ts`): the person asking is one person however
  many distributors she asks about.
- **Green**: `pnpm db:seed` twice with **no row-count change across all 139 tables**; `@dos/db` 101 tests
  including a rewritten `seed-demo.test.ts` that asserts all of the above per tenant on a FRESH database
  (the spec's pilot is slug `tarsun` now, so it models `pnpm db:seed` and not a near neighbour);
  **`pnpm smoke` 1588 calls · 917 OK · 563 expected · 0 BROKEN · 108 skipped across all eight services,
  admin :3007 included** (auth 11/3, owner 296/20, manager 280/35, sales 71/115, warehouse 95/137,
  delivery 104/130, retailer 47/123, admin 13/0 — every one of them 0 BROKEN).

**DELTA SYNC COVERAGE + ALL-IN-ONE (2026-09-06, sibling slice; local links unchanged).** The two founder
decisions of 2026-09-05 that were still half-built are finished.

- **Sync (docs/07 §0, docs/22 §8).** All **37** pull-able tables of `SYNC_PULL_TABLES` now have a
  `registerPull` in the module that owns them; a role receives exactly the tables `sync-tables.ts` names for
  it plus, for the desk, all of them — rep 21, crew 19, godown 13, **shop 18** — and that equality is asserted
  per role in `sync.coverage.spec.ts`. `retailer-service` mounts `sync` READ-ONLY (`manifest` + `pull` are
  ANY_MEMBER; `upload` and `errors.list` stay STAFF, so a shop carries no write queue). Tombstones come back
  from `sync_tombstones` minus the ids the caller can still see (a soft hide is per-reader). The LWW veto runs
  in `SyncService.upload` for every op of every table, so no module can forget it. The cursor is
  microsecond-precise and ADVANCES mid-page — a millisecond-truncated one re-read its own boundary rows for
  ever, and a page that did not move meant a device could never finish its first sync.
- **All-in-one (docs/26 §7).** `pnpm --filter @dos/all-in-one dev` → **:3100** with `/auth`, `/owner`,
  `/manager`, `/sales`, `/warehouse`, `/delivery`, `/retailer`, `/admin`, each the real service with its own
  role gate, `/health`, `/docs` and `/swagger`; `DOS_MODE=all WORKER_INLINE=1` starts the worker in-process.
  **Memory: 377 MB RSS with all eight mounted, from `dist/`** (420 MB under `@swc-node`), against the founder's
  400 MB budget; asserted in `libs/core/src/service/all-in-one.spec.ts`. The eight `ServiceDefinition`s now live
  in `libs/core/src/service/definitions.ts` and each `<name>-service/src/service.ts` re-exports one, so the
  split and the combined deployment cannot serve different modules.
- **Green both ways:** `pnpm smoke` **1588 calls · 0 BROKEN** on the eight ports and
  `pnpm smoke --base http://127.0.0.1:3100` **1588 calls · 0 BROKEN** through the prefixes; core 495 tests,
  every service spec, `@dos/db` 100, worker 3, contracts 78; `docs:readme:check` and `format:check` clean.
- **Needs `pnpm install`:** the new `backend/all-in-one` package (workspace deps only, no new catalog entry).

**Five defects the gate found and fixed, each with a test that fails without the fix.**

1. **`pnpm smoke --destructive` left the pilot distributorship SUSPENDED, with a green 200 in the log.**
   `admin.tenants.suspend` and `admin.tenants.reactivate` are a toggle whose bodies never change, and the
   harness keys idempotency by the day — so the second destructive run of a day REPLAYED both stored replies:
   the suspend did nothing, the reactivate did nothing, and the reactivate still answered `"status":"active"`
   while the row stayed suspended. Every one of the seven demo sign-ins then answered **423** and the next
   `pnpm smoke` could not even log in. Their key is now scoped to the RUN (`STATE_TOGGLE_OPS`), and the harness
   ENDS by signing in again — the one check an idempotency replay cannot satisfy.
2. **`pnpm db:seed` could not undo any of it.** CLAUDE.md's recovery line is "idempotent, re-run after
   `pnpm smoke --destructive`", but every statement in the seed is `insert … onConflictDoNothing()` against a
   row that already exists, so a suspended tenant, a disabled identity and a disabled membership all survived
   the re-seed. `restoreDemoAccess()` (`seed-demo/index.ts`) is that line's implementation, and it runs for all
   three demo distributors.
3. **`modules/ai` read a shopkeeper's shop across tenants.** `ownShopId()` filtered `retailer_links` by
   `user_id` alone, and `retailer_links_read` is deliberately `tenant_id = app.tenant_id OR user_id = actor`
   (that OR is the switch-distributor screen). With the founder's own three-distributor demo data —
   `ramesh.gupta` buys from all three — `limit(1)` with no order returned whichever link the planner picked:
   sometimes a 403 on the shop's own order (`a shop may only capture an order for itself`), sometimes ANOTHER
   TENANT'S retailer id written onto a draft in this one. Now scoped and ordered, like every sibling query.
4. **`admin.metrics.overview`'s spec was racy** — it compared a cross-tenant `count(*)` to a snapshot taken
   after the call while every other spec file was creating tenants in parallel (it failed 4130 vs 4137). The
   call is bracketed by two counts now, plus the partition identity `total = active + suspended + closed`.
5. **`sync.manifest` had no handler at all** (the sibling delta-sync slice declared it in the contract and in
   `permissions.ts` and stopped there), so `GET /sync/manifest` answered 404 to an anonymous caller and one
   case of FIVE service permission matrices failed. Built properly: the manifest is derived from the pull
   REGISTRY and from the Drizzle tables behind it, so it publishes exactly the tables `pull` will serve and
   exactly the columns those rows carry (`schemes` strips the funding source for a rep in both halves, from
   one `omit`), `writable` is "an upload handler is registered", and `schemaVersion` hashes the role as well
   as the tables. `tablePull()` now returns the whole `PullSpec`; the four modules that register pulls were
   updated to spread it.

**Carried, not blocking (for the sibling sync slice and the next session).** The retailer half of delta sync
is still unbuilt: `permissions.ts` grants `sync.manifest` / `sync.pull` to `retailer`, but no module registers
a shop read set and `retailer-service` does not mount the `sync` key, so both procedures keep the STAFF gate
until it does. `visits` is pull-able with no upload handler, so an offline rep's visit would come back
`unknown_table`. `tenancy.me` through a support pass answers 401 ("No active membership for this tenant") —
correct, but the console's support screen must not call it on open. `admin.tenants.create` still writes a real
distributorship per smoke run (4 `docs-distributor-*` slots so far) and there is still no `admin.users.enable`.
`docs/plans/00-coordination.md` predates modules 12 and 13: §2, §4, §6 and §8 name neither `ai` nor `admin`.

`modules/ai` is the four surfaces docs/22 §8 named on 2026-09-05, and none of them decides anything. A shop's
free-text WhatsApp message or a rep's spoken sentence becomes a **draft** order that a human always confirms
(`intake.parseText`, `intake.transcribe`, `drafts.*`); the stock ledger becomes a **reorder suggestion** for
purchase planning (`forecast.run/list`, moving average with a day-of-week shape, Croston for intermittent
SKUs, open POs netted); a trip's stops are **sequenced** by distance and soft time windows with the driver
free to override (`routing.plan/get/apply`, the pure `planRoute()` in `@dos/domain/routing`). Eleven
procedures on all six role services. The LLM sits behind `platform/llm.ts` with two drivers, and **every
request carries its own rule-based answer as a required fallback**, so no spec and no smoke probe ever opens a
socket (`NODE_ENV=test`, an empty `ANTHROPIC_API_KEY` or `AI_ENGINE=deterministic` all pin the deterministic
driver — the founder's 2026-09-05 "AI keys: stub drivers for now") and a model outage never loses an order.
The model reads LANGUAGE; the DATABASE decides the SKU, because the model never sees an id. A confirmed draft
becomes an order only through `OrdersService.insertDraft → writeLines → submitInTx`, and `routing.apply` moves
stops only through `TripsService.reorderStopsInTx` — the same code the crew's own drag-and-drop uses — so
pricing, credit, MOV, approvals and every stop refusal are exactly what they were.

**The gate ran the full chain on the founder's database:** `pnpm install` ("already up to date", lockfile
unchanged), `turbo run build typecheck lint test --force` (**48/48 tasks, 2300 tests**), a second
`turbo run test --force` (2300 again, 16/16), `docs:readme:check` + `format:check` clean in both workspaces,
the frontend chain (`lint`, `typecheck`, `build`, 9/9), **`pnpm smoke` 1562 calls · 0 BROKEN — five runs**
(plain, `--destructive`, `db:seed`, plain, and once more after the last code change), `pnpm db:seed` twice with
**identical row counts across all 138 tables**, `pnpm db:migrate` a no-op at **37 migrations** and
`pnpm db:generate` "No schema changes", every service `/health` + `/docs/openapi.json` (**10 `/ai/` paths on
each of the six role services and none on auth**, `x-roles` exactly the matrix tuples), the worker booted live
(the ai forecast pass registers, outbox relay ran with 0 failures), and the guarantees by hand with real
tokens: a retailer's `campa 1L 3 cs aur too yumm karare 2 peti` parses to a `needs_review` draft that reads
`2 peti` as 96 pieces and leaves the ambiguous line for a human, the godown reads a six-stop route plan, a rep
is 403 on the forecast list, and `ramesh.gupta`'s draft never touches an order until someone confirms it.

**Three real defects found and fixed by the gate, each with a test.**

1. **`tenancy.support.list / approve / revoke` had no handler at all.** The platform-console contract slice
   declared them in `contract.ts` and `permissions.ts` — inside the `tenancy` key, which every service already
   mounts — so all three routes 404'd on all six services, three cases failed in **every** service permission
   matrix, and `pnpm smoke` was 6 BROKEN. The gate built the owner's half properly
   (`modules/tenancy/support.service.ts`, 7 new specs): the owner sees who is asking and why, approves for at
   most the hours asked for (and fewer if they choose), or refuses; `rejected` and `revoked` stay
   distinguishable for ever; both answers land in the tenant's own `audit_log`. Migration **0035** adds
   `requested_hours`, `decision_note`, `revoke_reason`; **0036** replaces `dos_support_grant_guard()` so the
   owner may SHORTEN the window in the statement that approves it and never move it afterwards (0034 froze the
   column outright, which made the contract's own "may shorten it, never lengthen it" impossible to serve);
   **0037** adds a SECURITY DEFINER `dos_support_requester_names()` that returns one column for platform
   administrators only, because a support engineer holds no membership and `users_visible` therefore hides the
   one person the owner most needs to see — the narrow alternative to opening the users table.
2. **The godown could never see the route plan it loads the van by.** `ai.routing.get` is granted to
   `warehouse` by the permission matrix, but `route_plans_read` stopped at the back office, so that screen
   answered `200 { item: null }` for ever — a refusal nobody could see. 0035 widens the policy to exactly the
   roles that already read the TRIP.
3. **`RoutingService.plan` was writing the crew's plan as `system`.** `ai.routing.plan` is granted to
   `delivery`, but `route_plans_insert` admitted only the desk, so the service escalated — a wider grant than
   the thing it was allowing. 0035 gives the policy the same crew-of-this-trip branch its read and update
   policies already carried (and `trips_insert` already sets), and the escalation is gone: the database now
   refuses a driver who is not on the trip on its own instead of trusting two application checks.

Two smaller things the gate also fixed: the `ai` module built two SQL `IN` lists by string interpolation
through `sql.raw` (escaped, and every value uuid-validated at the wire, but the wrong pattern on values that
come out of a jsonb column) — both are bound parameters now; and `TripsService.reorderStopsInTx` was left with
two nested bare blocks and an `input` shim from the extraction, now unwound.

**Carried forward, none blocking.** (1) `pnpm smoke --destructive` **answers and then closes the one demo
support request**, and `pnpm db:seed` cannot restore it — an approval is revoked, never un-done (0034), so a
fresh pending request needs a fresh database; the closed grant still shows in the owner's list, which is a real
screen in itself, and both procedures then SKIP rather than break. (2) `docs/plans/00-coordination.md` has no `ai`
row: it needs §1 slot 12, §2 rows for 0031/0032 and the gate's 0035–0037, §4 the two new edges `ai → orders`
and `ai → delivery`, and §6 the `ai` key on all six services; `docs/23` predates the AI decision and has no
§8.x for the module; there is no `docs/plans/ai.md` (the module was designed from docs/22 §8, docs/23,
notifications.md and delivery.md). (3) **Nothing emits `InboundMessageReceived` yet** — the producer is the
WhatsApp webhook, which `docs/plans/notifications.md` deliberately leaves unbuilt; `parseInboundMessage` is
implemented, registered and tested (idempotent across redelivery), so the webhook only has to write the
`inbound_messages` row and one outbox row. (4) **A shop still cannot upload a voice note**: `OBJECT_DOMAINS`
and `ALLOWED_CONTENT_TYPES` now carry `voice` and the five audio types, but `FileDomainSchema`,
`FileMimeTypeSchema`, an `UPLOADERS['voice']` row including `retailer` and a `mayRead` case are contract
changes nobody has made; `intake.transcribe` works today because the deterministic transcriber answers
without bytes. (5) Open-PO netting is approximate by design — `purchase_orders` carry no location, so open
pieces are subtracted only at the primary godown. (6) `ai_forecasts` has no run table, so "idempotent per day"
is a deterministic pass key checked against `outbox_events`. (7) The draft `source` enum has no `sms` (an SMS
arrives as `text`), its terminal state is `expired` rather than `failed`, and confidences are basis points
here while docint exposes 0–1 floats — two conventions still coexist. (8) The demo catalogue's names stutter
in AI labels ("Too Yumm Too Yumm Karare Too Yumm Karare 60 g") because brand + product + variant are
concatenated — the repo's existing convention, shared with `docs/examples.ts` and used for trigram matching,
so it was left alone; it is a naming decision, not a bug.

**The ai slice, the platform-console contract/database slices and the gate's fixes are all in the working
tree — commit the snapshot before starting `admin-service`.**

---

**Earlier (STEP 11 DONE — three distributors + shared shops (2026-09-06 01:20 IST), verified by the independent gate. The ten-module backend
chain and the three-distributor demo are both complete; NEXT: the `admin-service` :3007 platform console (module 13 platform-admin,
docs/22 §8 2026-09-05) and module 12 `ai`, then the six apps.**
`pnpm db:seed` now writes **Tarsun Enterprises** (the pilot, ids unscoped so every `/docs` example, spec and smoke row is
byte-identical to before), **Sai Distributors** (Dombivli East, `SAI/`, starter, 26 SKUs) and **Kalyan Agencies** (Ulhasnagar,
`KA/`, growth, 24 SKUs). Each extra distributor has its own owner, manager, accountant, two warehouse hands, three reps, four
drivers, beats, price lists, schemes, suppliers, costs and a month of orders, invoices, receipts, trips and deliveries. **Ten shops
are on more than one distributor's books** — one `retailer_identities` row with a `retailers` + `retailer_links` row per tenant —
and five of those on all three; `ramesh.gupta` is ONE platform user with **three** memberships (`fatima.shaikh` two), so
switch-distributor has something to switch between. No migration, no contract and no permission change: this slice is all seed
(`backend/libs/database/src/seed-demo/tenants.ts` plus a scope on `demoId()` and a roster/network parameter on the builders) plus
the **ledger partition plan** addendum in `docs/20-scale-rules.md`.
The gate ran the full chain on the founder's database: `pnpm install` (“already up to date”, lockfile unchanged),
`turbo run build typecheck lint test --force` (**48/48 tasks, 2137 tests**), a second `turbo run test --force` (2137 again, 16/16),
`docs:readme:check` + `format:check` clean in both workspaces, the frontend chain (`lint`, `typecheck`, `build`, 9/9),
`pnpm smoke` **1475 calls · 0 BROKEN**, `pnpm smoke --destructive` (1475 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` twice more
(0 BROKEN each), `pnpm db:seed` twice with **identical row counts across all 131 tables**, `pnpm db:migrate` a no-op at 31
migrations and `pnpm db:generate` “No schema changes”, every service `/health` + `/docs/openapi.json` (auth 12 paths, owner 277,
manager 277, sales 156, warehouse 200, delivery 204, retailer 135 — unchanged, because the contract is untouched), and the
multi-tenant guarantees live with real tokens: each owner lists only its own shops (`R-` / `SD-` / `KA-`), a **Sai owner asking for
a Tarsun retailer id gets 404** (RLS, not a filter), a **Sai rep gets 403** on the stock-value register, `ramesh.gupta` switches
between all three tenants and reads **15 / 4 / 4 bills** under the right white-label display name each time, and in the database
every tenant's journals balance with **AR == the outstanding rollup** (₹4,59,863 Tarsun / ₹2,36,397 Sai / ₹2,31,232 Kalyan), with
10 shops on more than one distributor and 5 on three.
**No defect found; nothing was changed by the gate.** Carried forward, none blocking: (1) **on the founder's existing database Sai's
and Kalyan's HISTORICAL bills still read `INV/…`** — those two tenants were first seeded minutes before `seriesPrefix()` landed, the
seed is idempotent by row id and an issued invoice is immutable, so only a fresh database fixes it; their `numbering_series` rows are
already `SAI/` / `KA/` (next `SAI/9004`, `KA/9004`) so every bill the services issue from now on is correct, and the new spec proves
a fresh database is correct throughout. Remedy if the cosmetic mismatch matters: drop and recreate the local `dos` database, then
`pnpm db:migrate && pnpm db:seed` (all demo data is reproducible; only accumulated smoke/spec fixture rows are lost). (2) A
non-destructive `pnpm smoke` run leaves five of Rahul's six `rep_product_authorisations` deleted, because
`tenantCatalog.repAuthorisations.set` REPLACES a rep's brand list and the smoke harness does not class it as destructive; the next
`pnpm db:seed` restores them with the same ids, so the seed-twice idempotency check is clean, but a seed run straight after a smoke
run legitimately adds those five rows back. (3) Two unbalanced journal entries survive in the spec-fixture tenant `a-62c314f6` from
2026-09-04 23:44, i.e. from the window around migration 0007's SECURITY DEFINER fix; no new ones appeared across two full test runs
today, so the hole is closed — they are debris, not a live defect. (4) `Surat Sales Agency`, the inter-state IGST demo shop in
`seed-demo/billing.ts`, is hard-coded as `R-9024` and so appears under that pilot-style code in all three tenants; changing the code
string would orphan the existing row, so it was left alone. (5) The extra two distributors run `depth: 'core'` — no docint, claims,
notifications, incentives or integrations rows — which is what the brief asked for and keeps the pilot the only tenant `pnpm smoke`
exercises end to end. (6) `PeopleResult` still addresses people by the pilot's first names (`salespeople.rahul`, `delivery.ganesh`);
for Sai and Kalyan they mean "that tenant's first rep / first driver". (7) The demo scope is a module-level variable restored in a
`finally`, correct for the one sequential seed process but not for two tenants seeded concurrently.
The seed slice is in the working tree — **commit the snapshot before starting the admin-service console.**

**Earlier (MODULE 10 DONE — incentives, 2026-09-06 00:20 IST), verified by the independent gate; the ten-module backend chain
(receivables → billing → warehouse → delivery → docint → integrations → claims → notifications → reporting → incentives) completed
there.**
The gate ran the full chain on the founder's database: `pnpm install` (“already up to date”, lockfile unchanged),
`turbo run build typecheck lint test --force` (**48/48 tasks, 2136 tests**), a second `turbo run test --force` (2136 again, 16/16),
`docs:readme:check` + `format:check` clean in both workspaces, the frontend chain (`lint`, `typecheck`, `build`, 9/9 tasks),
`pnpm smoke` **1475 calls · 0 BROKEN**, `pnpm smoke --destructive` (1475 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` again (0 BROKEN),
`pnpm db:seed` twice with **identical row counts across all 131 tables**, `pnpm db:migrate` a no-op at 31 migrations, `pnpm db:generate`
“No schema changes”, every service `/health` + `/docs/openapi.json` against coordination §6 (**14 incentives routes on owner :3001,
manager :3002, sales :3003 and delivery :3005, and zero on auth, warehouse and retailer**, `x-roles` exactly the §6 tuples), and the
privacy guarantee by hand with real tokens: the owner reads six active targets across four staff, Rahul and Ganesh read only their own
two, a rep asking for another rep's target id gets **404** (RLS, not a filter), `progress/team` and every write are **403** for a rep,
an idempotency key reused with a different payload is **409**, and the seed's 10 targets / 9 achievements / 3 statements with one
approval are **byte-identical after three smoke runs** — the docs examples restore themselves. The worker path was run under tsx
(not just typechecked): `@dos/core/incentives` resolves with no Nest DI, the sweep touched 21 tenants / 74 targets, a single
`recomputeAchievement` reproduced the API's figure exactly (15,247,882 paise / 1694 bps) and a deleted target is a no-op, not an error.

**Two real defects found and fixed by the gate, each with a test.** (1) **`pnpm smoke` was permanently 2 BROKEN on this machine and it
was nothing to do with incentives.** The docs examples walk an id “slot” sequence so a published example is always executable;
`freeSlots` probes sixteen windows of 256, but the two bespoke pickers — `procurement.supplierInvoices.create` (which must also find a
free document number) and `tenancy.staff.create` (also a free username and phone) — probed a SINGLE window and then fell back to a fixed
range the previous run had already taken. The founder's database held 258 `DOCS/26-27/*` invoices and 249 `demo.docs.staff*` users, so
the owner and manager documents were publishing `DOCS/26-27/0257` and `0258` into a permanent 409, and staff was seven slots from the
same wall. Both now go through one `walkFreeSlots`. The existing spec missed it because it reads only the SPARE lane, which sat past
the used range: the new case checks **every** service lane's id, document number, username and phone. (2) **`targets.remove` could
silently pay a rep short.** `achievements.target_id` is a foreign key and an FK check bypasses row security, but the cache row is
`system`-write-only, so the owner's own transaction cannot clear it — the delete is therefore three steps, and step 2 drops the cache
row in a `withSystem` transaction scoped to the caller's own tenant. If step 3 then refused (an idempotency key reused with a different
payload), the derived row was gone for good: the hourly sweep only revisits OPEN periods, and `statements.compute` reads the cache, so
a CLOSED period — exactly the kind a statement is struck against — would have paid 0 for that target with nothing on screen saying why.
A fourth step now recomputes it best-effort without masking the real error, and a spec reuses a key across two targets and asserts the
survivor's cached figure comes back.
Carried forward from the implementer, none blocking: incentives reads the SOURCE tables through the three functions rather than
reporting's rollups (coordination §4 lists `incentives → orders / retailers / receivables`, and `daily_rep_stats` carries no brand
dimension, no distinct-outlet count and no completed-visit distinction — all three of which a target needs); `orders/fill-rate.ts` and
`reporting/rollup.ts` still window on `created_at` where `salesAggregate` windows on `coalesce(confirmed_at, created_at)`, so the
fill-rate register and the daily rollup will disagree with incentives about which month a demo order belongs to — not in this slice
and not touched; `reopen` on an unapproved statement is a loud 409 rather than a silent success; achievement is what was BOOKED, so a
return does not claw a payout back (coordination §7 q6, recorded not hidden); and the demo period is pinned to the seed's `TODAY`
(2026-09-04), so a demo walked through in October wants a reseed before the “this month” targets read as active again. One thing the
gate saw once and could not reproduce, filed as a separate task: `receivables.spec.ts`'s ageing-history case failed in a run that
STRADDLED IST midnight (23:59:51 → 00:00:13) because its fixture dates rows from `businessDate()` at setup and the server snapshots
them under the next day's date; it passed immediately afterwards and in both full runs. Reporting's and incentives' slices are in the
working tree — **commit the snapshot before starting the three-distributor demo.**

**Earlier (MODULE 9 DONE — reporting, 2026-09-05 22:55 IST), verified by the independent gate; then: incentives (step 10 of 10, the last
backend module) is starting — its contract `incentives.ts` is already mounted in `contract.ts` and migrations 0029/0030 are already
applied from the parallel DB/contract slice; `modules/incentives` still holds only a README, so the core module is what comes next.**
The gate ran the full chain on the founder's database: `pnpm install` ("already up to date", lockfile unchanged),
`turbo run build typecheck lint test --force` (**48/48 tasks, 2040 tests**), a second `turbo run test --force` (2040 again, 16/16),
`docs:readme:check` + `format:check` clean in both workspaces, the frontend chain (`lint`, `typecheck`, `build`, 9/9 tasks),
`pnpm smoke` **1419 calls · 0 BROKEN**, `pnpm smoke --destructive` (1419 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` twice more
(0 BROKEN each; the OK/EXPECTED flips between runs are the known approvals / picklist demo drift, none in reporting),
`pnpm db:seed` twice with identical row counts across all **131 tables**, `pnpm db:migrate` a no-op at 31 migrations,
`pnpm db:generate` "No schema changes", every service `/health` + `/docs/openapi.json` against coordination §6 (reporting's **33
procedures on owner / manager / sales / warehouse / delivery and zero on auth and retailer**; `x-roles` exactly the §6 tuples plus
`owner`-only for the new `series.grossMargin`), live role gates with real tokens (stock value 200 for owner/manager/accountant and
403 for salesperson/warehouse/delivery, gross-margin series 200 owner and 403 manager AND accountant, fill rate 200 warehouse / 403
salesperson, delivery performance 200 crew / 403 warehouse, exports 403 salesperson, every `/reporting/*` a 404 on retailer-service,
401 with no token, a rep asking for another rep's day silently answered with its own, the desk omitting `userId` a 400 naming the
field), the database half of the cost boundary by hand (`app_rw` as `retailer` reads **0 rows** of all five reporting tables; as
`salesperson`, 0 rows of `daily_owner_stats` but the staff-visible tenant rows), and the built worker booted live: the 15-minute
`reporting.rollup.schedule` fired at 22:45 and wrote Tarsun's row for today (462 orders, ₹1,91,701 invoiced) while the outbox relay
published 1000 rows a tick with 0 failures. **One real defect found and fixed by the gate, with a test:** the three registers ordered
FOR THE READER — worst fill rate first, biggest scheme spend first, trips by date — paged with a keyset cursor (`id > cursor`) on an
id the list is not sorted by, so scrolling silently dropped rows: on the demo data fill rate answered 29 variants in one page and
**5** when walked, scheme spend 72 against **11**, delivery performance 18 against 7 — and because the CSV renderer walks the same
cursor, the exported file was short too (a GSTR-2-adjacent extract and the godown's picking-accuracy screen both wrong). They now
page by offset (`pageByOffset` in `reporting.internals.ts`, which documents why the other five registers keep their keyset cursor);
a new spec walks **every** paged register one row at a time and asserts the walk equals the single page, row for row and in order,
and the fixture gained two more short-picked variants so worst-first order deliberately disagrees with id order. Three more tests
the gate added: the two brief §5 cases that were never written (**scheme spend splits company from distributor funding** and drops a
cancelled bill's rules; **the GST purchase register counts only `received` supplier bills**, never extracted / in review / disputed /
cancelled) and the incentives contract's payout-slab doc example (`examples.spec` was failing 4 cases because the sibling incentives
contract landed with a `payoutRule` refinement no sampler can satisfy — `docs/examples.ts` now carries one readable slab table for
`targets.upsert` / `bulkAssign` / `whatIf`, asserted by shape). `backend/tools/smoke-endpoints.mts` also names a real rep for
`reporting.dashboard.rep`, which was an EXPECTED 400 on owner and manager only because the harness sends required parameters only.
Carried forward from the implementer, none blocking: the backdated 400 days of rollup rows are DERIVED, so a register (live tables)
shows the real 14 seeded days while a series (rollup) shows 13 months — that is the split the rollup exists for, and it means
`registers.gstSalesRegister` over a backdated month is empty while `series.sales` shows a curve; `series.deliveryPerformance` and
`series.outstanding` change source when filtered (unfiltered they read `daily_tenant_stats`, with `driverId`/`vehicleId`/`beatId`/
`retailerId` they fold delivery's per-trip rows or receivables' ageing snapshots, so the numbers can differ slightly where a snapshot
is missing); `series.sales` refuses `brandId` AND `beatId` together (400 `unsupported_filter`) because the rollup cannot intersect
two jsonb mixes — a `by_brand_beat` mix would be needed; `activeRetailers` is SUMMED across days, so a shop that ordered twice in a
week counts twice (`series.topShops` is the honest distinct answer); `registers.stockValue` / `fillRate` and `dailyStats.*` aggregate
in memory over a bounded read (5,000 variant×location rows / 2,000 variants / a 92-day window), exact within that bound and not
beyond; `daily_owner_stats.scheme_spend_distributor_paise` is still 0 in the LIVE 14-day seed window (docs/plans/reporting.md §6
item 3 — orders crossing ₹5,000 so the seeded `order-2pct-5000` distributor-funded scheme fires — was not done; the backdated history
does carry a distributor-funded component); `DATABASE_REPLICA_URL` is now a supported optional environment variable and belongs in
docs/26; and reporting is mounted whole on sales / warehouse / delivery per coordination §6, so those apps' `/docs` list the
back-office registers they will always be 403'd from (the brief §4.7 wanted them invisible there; coordination wins). Reporting's
slice (33 procedures, `modules/reporting/**`, `@dos/core/reporting` worker subpath, `DB_REPLICA`, the twenty `report_*` renderers,
`worker/src/jobs/reporting.ts`, seed `reporting.ts` + the `sales.ts` short picks, no migration) plus the incentives contract and
migrations 0029/0030 are in the working tree — **commit the snapshot before starting incentives.**

**Earlier (MODULE 8 DONE — notifications, 2026-09-05 21:25 IST), verified by the independent gate; then: reporting (step 9 of 10) started
(its contract `reporting.ts` is already mounted in `contract.ts` and migrations 0027/0028 are already applied, from the parallel
DB/contract slice; `modules/reporting` holds only a README — the core module is what comes next).**
The gate ran the full chain on the founder's database: `pnpm install` ("already up to date", lockfile unchanged),
`turbo run build typecheck lint test --force` (48/48 tasks, **1826 tests**), a second `turbo run test --force` (1826 again, 16/16),
`docs:readme:check` + `format:check` clean (both workspaces), the frontend chain (`lint`, `typecheck`, `build`, 4/4 tasks),
`pnpm smoke` **1254 calls · 0 BROKEN**, `pnpm smoke --destructive` (1254 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` twice more
(1254 · 0 BROKEN each), every service `/health` + `/docs/openapi.json` checked against coordination §6 (notifications' 14
procedures on ALL SIX role services and none on auth; `x-roles` exactly the §6 tuples: messages list/get/markRead every member,
resend + templates.list + broadcasts.list/get back office, templates.upsert + broadcasts.create owner/manager, push tokens staff
(no retailer), inbound triage (owner/manager/accountant/salesperson); `messages.send` is a new procedure §6 never listed —
owner/manager/accountant/delivery, i.e. the desk and the crew, never the rep, the godown or the shop), live role gates with real
tokens (accountant 403 on `templates.upsert` and 200 on `templates.list`, manager 200 on the upsert, salesperson 403 on templates
and 200 on inbound, warehouse 403 on inbound and 200 on messages, retailer 200 on its own messages and 403 on broadcasts and push
tokens, 401 with no token, 404 on the auth service), `pnpm db:seed` twice with identical row counts across all **131 tables**,
`pnpm db:migrate` a no-op at 29 migrations, `pnpm db:generate` "No schema changes", and the built worker booted for 80 s: the
notifications handlers registered on the relay, 1000 outbox rows relayed per tick (0 failed, 0 dead-lettered) and 200 messages
dispatched per tick through the stub (194 sent / 6 delivered / 0 failed). Four defects found and fixed by the gate, each with a
test: (1) **the dispatch sweep is cross-tenant and bounded at 200 rows, and the founder's database holds ~1,400 due messages across
168 tenants**, so the notifications spec's own rows sorted behind them and three cases failed on this machine while passing on an
empty one — `dispatchDueMessages` now takes an optional `tenantIds` scope (also the operational lever for re-driving one
distributor's queue after its credentials are fixed), the spec names its own two tenants, and a new case proves a scoped tick
leaves another distributor's due row alone and the next tick that names it sends it; (2) **`pnpm db:seed` was not idempotent on a
FRESH database** — the notifications seed read `deliveries` and `receipts` with `ORDER BY <timestamp> LIMIT n` over heavily tied
timestamps, and a LIMIT across a tie is not a stable order in Postgres, so the second seed picked a different subset and inserted
two more message rows (`messages: 177 -> 179` in `seed-demo.test.ts`); both queries (and the same latent pattern in the
integrations seed's Tally export) now tie-break on `id`; (3) **turbo `concurrency: 4` no longer fits this 8 GB Mac** — `@dos/core`'s
typecheck, its type-aware lint and its 27-file vitest pool all start together, and macOS killed them mid-run with no output at all
(three tasks reporting `ELIFECYCLE Command failed` while each passed alone), twice in a row; it is now `2`, with the measurement in
the comment (48/48 tasks, 1826 tests, whole graph in 1m22s); (4) the owner app's `Pricing.tsx` did not typecheck — `schemes.list`
answers the union `SchemeView` (the field and the shop never see `fundingSource` / `claimable`, docs/17 §B) and the page read the
wide fields without narrowing; it now narrows through a documented guard. Carried forward from the implementer, none blocking:
`templates.upsert` for a MANAGER runs the write with `app.actor_role` escalated to `system` because the RLS policy
`templates_write` admits owner/system only while PERMISSIONS says MANAGEMENT (a follow-up expand migration widening the policy to
MANAGEMENT_ROLES would let the escalation go); the WhatsApp/MSG91 delivery-status webhook and the inbound capture route are NOT
built (whatsapp/sms rows stop at `sent`, `inbound_messages` / `whatsapp_windows` are seeded only); push is a stub (no FCM/Expo
sender) and `email` dead-letters at once; the worker skips outbox events older than 48 h so the historical backlog is not
announced (§7 question: is 48 h right?); `OrderSubmitted` pings every desk device for EVERY submitted order (narrow it on
`approvalFlags` if only flagged orders should); `consentedAt` is exposed but not enforced as a gate on marketing broadcasts; each
`pnpm smoke` leaves one broadcast per owner/manager lane and one on-demand message per owner/manager/delivery lane (the same
growth pattern as orders); the sweep's ordering is global, so one tenant's very large backlog does hold the queue for as many
ticks as it takes to drain — per-tenant fairness (docs/20 rule 5) is a §7 question and `tenantIds` is the lever until it is
answered; and with the worker running beside the services, integrations' minute sweep re-runs already-inline import jobs and marks
them `failed` (`INTEGRATIONS_INLINE_JOBS=0` is the documented remedy; no Tarsun row was harmed — its two staged wizard jobs are
intact). Notifications' slice (14 procedures, `modules/notifications/**`, `@dos/core/notifications` worker subpath, provider
adapters, migrations 0024/0025, seed `notifications.ts`, worker jobs `notifications.dispatch` / `deliveryToday` / `duesReminder`)
plus the reporting contract and migrations 0027/0028 are in the working tree — **commit the snapshot before starting reporting.**

**Earlier (MODULE 7 DONE — claims, 2026-09-05 19:55 IST), verified by the independent gate; then: notifications (step 8 of 10)
(its contract `notifications.ts` and migrations 0024/0025 are already in the working tree from the parallel DB/contract slices; the core
module `modules/notifications` is what comes next).**
The gate ran the full chain on the founder's database: `pnpm install` ("already up to date", lockfile unchanged), `turbo run build typecheck lint
test --force` (48/48 tasks, **1702 tests**), a second `turbo run test --force` (1702 again, 16/16) and, after the gate's own fixes, the full
chain once more (48/48, **1703 tests** with the new spec) plus a second test run (1703), `docs:readme:check` + `format:check` clean (both
workspaces), `pnpm smoke` **1170 calls · 0 BROKEN**, `pnpm smoke --destructive` (1170 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` again
(1170 · 0 BROKEN; the run-to-run OK/EXPECTED flips are the known approvals/picklist/pack demo drift after a destructive run, none in claims),
every service `/health` + `/docs/openapi.json` checked against coordination §6 (claims' 23 procedures / 19 paths on owner and manager only,
`x-roles` owner/manager/accountant, `policies.upsert` owner, `writeOff` owner + accountant; none on auth, sales, warehouse, delivery or
retailer), live role gates with real tokens (salesperson 403 on :3001, 404 on :3003/:3004/:3005/:3006 where the key is not mounted, 401
without a token, accountant 403 on `policies.upsert`, manager 403 on `write-off`; ageing keeps the brand-DMS group in `groups` and out of
`totals`), `pnpm db:seed` twice with identical row counts across all 129 tables, `pnpm db:migrate` a no-op at 27 migrations, `pnpm db:generate`
"No schema changes", the whole migration chain 0000→0026 applied on a FRESH database in one transaction followed by the seed (7 claims / 28
lines / 3 settlements / 2 sheets, CLM-0007 brand_dms with no journal), and the built worker booted for 80 s: outbox relay 585 published /
0 failed, the seeded queued CLM-0002 sheet swept and rendered by the registered `claim_sheet` renderer into a real XLSX (8 rows, "Claimed by
Tarsun Enterprises", no product branding). Three defects found and fixed by the gate, none inside the claims module itself: (1) on a FRESH
database the second `pnpm db:seed` added one row — the pending van-sale order `SO-9003` lived in `seedBilling` but only exists when the van
carries stock, and `seedWarehouse` (which loads the van) runs after billing; it is now `seedPendingVanSaleOrder`, called right after
`seedWarehouse`; (2) `seedStock` picked the godown with an unordered `find(kind === 'warehouse')`, which on the founder's re-seeded database
(smoke probes + "Demo Godown (docs)" are `warehouse` rows too) resolved to the docs godown, so the claims seed's two `expiry_writeoff`
movements debited a location the lots were never in (those two append-only rows stay on the founder's copy; the fresh seed is right); the
pick is now the bootstrap `Godown`, oldest first; (3) the seeded claim-sheet snapshots left `retailerName`/`retailerCode` null (empty "Party"
column on the demo sheet) while the live `statements.generate` fills them — the seed now looks the shops up, and the founder's two seeded
snapshots were backfilled by hand. All three are locked by a new DB-backed spec `libs/database/src/seed-demo.test.ts` that creates its own
empty database, migrates it, seeds it twice and compares every table (≈3 s). Carried forward from the implementer, none blocking: write-off
posts Dr `BAD_DEBTS` / Cr the receivable (the brief's Dr `SCHEME_EXPENSE`/`DAMAGES` variant is documented in `claims.service.ts`, not used —
founder/CA call); migration 0026's index predicate spells "cancelled" as `claim_no IS NULL AND status <> 'draft'` because a new enum value
cannot be used in the transaction that adds it; the worker crons `claims.period.rollover` / `claims.overdue.sweep` are not built
(`periods.list` gives the desk the same view on demand); `claims.periods.list` estimates ≈600 ms on the demo tenant — cache if a screen
polls it; the very first seed on the founder's database (before the invoice-line rule filter) left CLM-0001 with one August line
(53,616 paise) and the expiry draft with one line — consistent, just smaller than the fresh seed; each `pnpm smoke` leaves one
partially-settled `other` claim of ₹1,400 on Alan's (the docs story, closed by `--destructive`); today's many smoke runs have emptied one
Godown lot, so `warehouse.orders.pack` / `loadSheets.confirm` now answer 400 "insufficient stock" (EXPECTED, demo drift, a GRN or a fresh
seed restores it). Claims' slice (23 procedures, `modules/claims/**`, `@dos/core/claims` worker subpath, `claimMachine`, migration 0026,
seed `claims.ts`, callee additions in pricing/inventory/procurement/tenant-catalog/billing/integrations) plus the notifications contract +
migrations 0024/0025 are in the working tree — **commit the snapshot before starting notifications.**

**Earlier (MODULE 6 DONE — integrations, 2026-09-05 18:40 IST, verified by the independent gate).**
The gate ran the full chain on the founder's database: `pnpm install` ("already up to date", lockfile unchanged), `turbo run build typecheck lint
test --force` (48/48 tasks, **1626 tests**), a second `turbo run test --force` (1626 again, 16/16) and, after the gate's own fixes, the full
chain once more (48/48, **1627 tests** with the new spec cases), `docs:readme:check` + `format:check` clean
(both workspaces), `pnpm smoke` **1124 calls · 0 BROKEN**, `pnpm smoke --destructive` (1124 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` again
(1124 · 0 BROKEN), every service `/health` + `/docs/openapi.json` checked against coordination §6 (integrations' 21 procedures on owner and
manager only, `x-roles` owner/manager/accountant; none on auth, sales, warehouse, delivery or retailer; claims mounted nowhere yet), live role
gates (accountant reads + exports 200 and every import write 403; salesperson 403 on :3001; manager `commit` of `opening_outstanding` 403 "only
the owner"; owner dry run of the seeded outstanding file = 6 bills, ₹1,09,805.50), `pnpm db:seed` twice with identical row counts across all
128 tables (the 8 seeded import jobs stay 4 confirmed / 2 staged / 1 cancelled / 1 failed), and `pnpm db:migrate` a no-op at 24 migrations
(0023 `integrations_wizard`, generated, expand-only: three `job_status` values + the wizard columns). Two defects found and fixed by the gate
(each with a test so it cannot return): (1) `examples.spec` failed 4 cases because the claims contract landed with no `OVERRIDES` entry for
`claims.evidence.attach` ("exactly one of documentId or objectKey") — `docs/examples.ts` now gives it the claim's `files.uploadUrl` key and no
document id, asserted by a new spec case; (2) **`pnpm smoke --destructive` took the owner app's import review screen away for good**: the
published `imports.cancel` example cancelled the SEEDED staged party master (a cancelled job is terminal and the idempotent seed never
recreates it), so the next lane's `imports.create` had no seeded file to re-stage and landed `failed` with every later wizard step a 409 —
the same class as the delivery gate's TRIP-NEXT. The harness now stages a throwaway import of its own from the same file and profile and
cancels THAT (`chain.importCreateBody`), `collectIntegrations` falls back to the newest party master that ever parsed (never a made-up key),
a DB-backed spec asserts the wizard example's `sourceObjectKey` belongs to a job with `total_rows` set, and the founder's seeded job
`72cdae27…` was restored to `staged` by hand. Carried forward from the implementer, none blocking: the retailers demo seed writes
`external_party_codes` under system `field_assist` (underscore) while the importer's source key is `fieldassist` (the integrations seed adds
its own `fieldassist` rows; unify later); `INTEGRATIONS_INLINE_JOBS` defaults to inline outside production (set `0` with the worker running);
rollback is one transaction (fine for the reversible window, could move to the worker for a 50k-row run); built-in vendor profiles are written
on first use per tenant (`ensureBuiltinProfiles`), not by onboarding — coordination §7 question; coordination §2 should record 0023 as
integrations' migration and §3.9 the additions to retailers (`import.ts`), tenant-catalog (`import.ts`), billing (`cancelImported`,
`externalInvoiceNumbersOnFile`, `invoicesForExport`, `creditNotesForExport`, `createBillingStack`), receivables (`entryIdByRef`,
`receiptsForExport`), procurement (`listForExport`), inventory (`locationNames`), platform (`csv.ts renderCsv`); docs/23 O21/O22/M13 call
lists use the contract's names (`rows.review`, `exports.request`, GET `preview`, POST `dryRun`). Integrations' slice (21 procedures,
`modules/integrations/**`, `@dos/core/integrations` worker subpath, `importJobMachine`, migration 0023, seed `integrations.ts`, worker queues
`imports.run` / `exports.render` + sweep) is in the working tree — **commit the snapshot before starting claims.**

**Earlier (MODULE 5 DONE — docint, 2026-09-05 15:00 IST, verified by the independent gate).**
The gate ran the full chain on the founder's database: `pnpm install` ("already up to date", lockfile unchanged), `turbo run build typecheck lint
test --force` (48/48 tasks, **1550 tests**) and a second `turbo run test --force` (1550 again, 16/16), `docs:readme:check` + `format:check` clean
(both workspaces), `pnpm smoke` **1082 calls · 0 BROKEN**, `pnpm smoke --destructive` (1082 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` again
(1082 · 0 BROKEN), every service `/health` + `/docs/openapi.json` checked against coordination §6 (docint's 26 procedures on owner, manager and
warehouse; none on auth, sales, delivery or retailer; the warehouse role gets 403 on every priced/review procedure), `pnpm db:seed` twice with
identical row counts across all 127 tables, and `pnpm db:migrate` a no-op at 21 migrations (0020 `outbox_relay` was committed with the delivery
snapshot). No defects found; nothing changed by the gate. Beyond the mechanical checks the gate read the Anthropic adapter against the current
Messages API reference (`output_config.format` json_schema, `thinking: adaptive`, effort inside `output_config`, cached system block, base64
image/document blocks, `refusal`/`max_tokens` stop reasons, Sonnet 5 / Opus 5 prices — all current), confirmed every handler is
`requireRole → requireDb → withTenant → idempotent` (reads through `asCaller` = `withTenant`), that `documents.status` is written only through
`documentMachine.next()`, and **booted the built worker against the live queues for 150 s**: it relayed the 1145 pending `DocumentRenderRequested`
rows (PDFs rendered into `backend/.storage`) and 104 `docint.document.submitted` rows, 0 failed, 0 dead-lettered; the qr-read jobs it queued are
no-ops because those documents were already processed inline (`DOCINT_INLINE_JOBS=1` in `.env`). Follow-ups, none blocking: (a) the Anthropic
adapter is raw `fetch`, untested against the live API (no key in `.env`) — swapping to `@anthropic-ai/sdk` means adding it to the catalog +
`libs/core/package.json` and `pnpm install`; (b) `failed` is terminal, so a document that exhausts `DOCINT_MAX_ATTEMPTS` must be re-photographed
or typed through `procurement.supplierInvoices.create`; (c) `documents.approve` refuses `kind = brand_dms_invoice` (billing's `importBrandDms` is
that path); (d) a client-supplied `sha256` on `addPage` would save the read-back on S3; (e) the HTTP `procurement.supplierInvoices.create` still has
no `rateBasis`/`basisQty` on its wire (docint passes them through `createInTx`). Docint's slice (26 procedures, `modules/docint/**`, worker relay +
queues, seed `docint.ts`) is in the working tree — **commit the snapshot before starting integrations.**

**After the backend chain and the seven apps (founder, 2026-09-05 17:20 IST):** (1) install on the Mac everything the end-to-end run needs
(simulators, Expo dev builds, worker, all services) and hand over a written run-through — what starts, in which order, which port, which
sign-in, where the data shows up; (2) deployment goes least-cost on AWS per `docs/26-environments-and-configuration.md` (six confirmations
pending in docs/22 §10).

**Earlier (MODULE 4 DONE — delivery, 2026-09-05 13:45 IST, verified by the independent gate).**
The gate ran the full chain on the founder's database: `pnpm install` (lockfile unchanged), `turbo run build typecheck lint test --force`
(48/48 tasks, **1442 tests**) and a second `turbo run test --force` (1442 again), `docs:readme:check` + `format:check` clean, `pnpm smoke`
**1004 calls · 0 BROKEN**, `pnpm smoke --destructive` (1004 · 0 BROKEN, 2 throwaway trips swept by the owner), `pnpm db:seed`, `pnpm smoke` again
(1004 · 0 BROKEN), every service `/health` + `/docs/openapi.json` checked against coordination §6 (delivery's 32 procedures on owner, manager,
warehouse, delivery and retailer; none on sales or auth; docint mounted nowhere yet), `pnpm db:seed` twice with identical row counts across all
126 tables, and `pnpm db:migrate` a no-op at 18 migrations. Four defects found and fixed by the gate (details in the status row): the full turbo
graph thrashed this 8 GB Mac (10 concurrent tasks → swap → 30 s test timeouts at random; `turbo.json` now caps `concurrency` at 4 and the whole
graph runs in 58 s instead of 2m30 s), the delivery spec built five bills inside one 30 s `it` (moved to a hook), `tenantCatalog.packConfigs.upsert`
answered 500 when a client id already named another supplier/variant pair (now 409, and the Swagger example names the row the natural key
resolves to), and `pnpm smoke --destructive` cancelled the demo's planned trip TRIP-NEXT for good (a cancelled trip is terminal and the seed
never recreates one; the harness now cancels a plan of its own on the smoke vehicle, and the founder's TRIP-NEXT was restored by hand).
The docint contract (`docint.ts`, mounted in `contract.ts`, 26 permission rows, migrations 0016/0017) was in the working tree from the
database slice; `modules/docint` was built next (see above).

**Earlier (MODULE 3b DONE — platform-gaps, 2026-09-05 10:40 IST, verified by the independent gate).**
The gate ran the full chain on the founder's database: `pnpm install` (lockfile unchanged), `turbo run build typecheck lint test --force`
twice (48/48 tasks, **1254 tests**, both runs), `docs:readme:check` + `format:check` clean, `pnpm smoke` **844 calls · 0 BROKEN**, then
`pnpm smoke --destructive` (844 · 0 BROKEN), `pnpm db:seed`, `pnpm smoke` again (844 · 0 BROKEN), every service `/health` + `/docs/openapi.json`
checked against coordination §6 (`files` on owner/manager/warehouse/delivery/retailer, `receivables` + `billing` on sales, none on auth), and
`pnpm db:seed` twice with identical row counts across all 126 tables. Four defects were found and fixed by the gate (details in the status row):
a 500 on a repeated write-off id (now 409), two dead-end Swagger examples (`allocations.remove`, `invoices.cancel` pointed at made-up rows),
a parked-pack example whose fixed invoice id collided after one press, and the delivery seed double-paying bills the receivables seed had
already settled (which is what made `pnpm db:seed` fail). Delivery's slice (contract `delivery.ts`, migrations 0014/0015, seed) is in the
working tree, its `modules/delivery` is NOT built yet — that is the next module. **Commit the snapshot before starting it.**

**CHAIN PLAN (2026-09-05 13:50):** the running chain (`dos-modules-4-10.js`, run wf_d2de989f-214) ends with three-distributors + final gate. IMMEDIATELY after it reports, launch `scratchpad/dos-modules-12-13.js` (module 12 `ai`: WhatsApp/voice order drafts, forecasting, routing; module 13 `platform-admin`: admin-service :3007; then demo + final gate) — founder scope additions of 2026-09-05. Confluence rewrite runs separately on Opus (run wf_ad61e0e5-f17). Frontend starts only after module 13 is green.

**LAYOUT CHOSEN (2026-09-05): A Ledger.** Frontend visual work is unblocked; apps still start after the backend is complete.

**Single source of truth: `docs/22-source-of-truth.md`** (read it before this file). Rendered view: https://claude.ai/code/artifact/24c323d8-5b45-4045-8e16-e0e549233fdd — republish it after editing the markdown with `python3 docs/tools/render-source-of-truth.py <out.html>` and the Artifact tool on that same URL.

**STANDING INSTRUCTION FROM THE FOUNDER (2026-09-05 09:20): "I expected you to complete all modules then stop. Now on keep developing until
there is a hard blocker."** So: every turn that receives a module-completion notification must (1) verify independently (full turbo run,
`pnpm smoke`, `docs:readme:check`, `format:check`), (2) record the result here, and (3) LAUNCH THE NEXT MODULE IN THE SAME TURN. Never end a turn
with nothing running unless the backend is complete or something is genuinely blocked. Development stopped once on 2026-09-05 after billing
because the turn ended without launching warehouse — that must not happen again. The remaining modules 4-10 are chained into ONE workflow
with a hard verification gate between each, so the chain itself carries on; if a usage limit kills it, resume it with `resumeFromRunId`
(completed agents replay from cache).

### Earlier resume notes (2026-09-04 23:20, laptop sleep)

**SWAGGER PHASE COMPLETE (2026-09-05 00:40 IST), independently verified by the main session:**

- `pnpm smoke` (backend/tools/smoke-endpoints.mts) signs in as each service's role, reads that service's own OpenAPI document and calls EVERY
  operation with the example it publishes. Result: **369 calls · 245 OK · 97 correct business refusals · 0 BROKEN · 27 skipped as destructive.**
- Every operation's example is built from REAL seeded rows by `backend/libs/core/src/docs/examples.ts` — no `string`, no placeholder uuid — and
  is repeatable: created ids come from database-probed free slots per service lane, so pressing Execute twice, or two services rebuilding their
  documents in the same second, cannot collide. Role-scoped too: a service without a back-office role does not get credit fields in its example,
  and the retailer service's examples name the shop actually linked to `ramesh.gupta`.
- Swagger UI at `/swagger` and Scalar at `/docs` on every service, both reading `/docs/openapi.json`, every operation annotated with `x-roles`.
- CORS added to every service (`corsOptions` in bootstrap.ts, `CORS_ORIGINS` env): without it no web app could call auth-service AND its own
  service, which are different origins by definition.
- Whole workspace: 48/48 turbo tasks, **534 tests**, `docs:readme:check` and `format:check` in sync (generated READMEs are prettier-ignored so
  the two checks cannot disagree).
- Owner app verified end to end in a real browser: sign in as sunil.tarsun / Dos@1234 → token → Retailers page lists all 36 shops. Fixed a real
  bug there: the app built its auth base URL as origin + `/auth` while the routes already start with `/auth`, so every login hit
  `/auth/auth/login` and 404'd.

**LAYOUT OPTIONS PUBLISHED for the founder to choose from (2026-09-05 00:45):**
https://claude.ai/code/artifact/23d860b3-9f0a-49a2-97c6-0f99ad25ad4d — four visual directions (A Ledger, B Instrument, C Panel, D Signal), each
rendered as an owner dashboard at desk width AND a salesperson shop screen at phone width, using real Tarsun data. The founder picks one letter
(or a mix) and that direction applies to all six apps. **No frontend code until that pick.** Source: docs/design/UX-00-design-system.md (797
lines, the full system) backed by UX-01 field reality, UX-02 current standards, UX-03 technical constraints.

**MODULE 1 OF 10 DONE — receivables (2026-09-05 01:30), verified independently by the main session:**

- Migrations 0006 (generated) + 0007 (hand-written) applied. **The journal-balance security hole is closed and was proven the honest way:** the
  agent wrote the test first, applied only 0006, and watched a `delivery` actor commit a two-line entry with a 100-rupee hole — silently, exactly
  as predicted. It then applied 0007 and watched the same test reject it, then tightened the assertion to prove the trigger now SEES the lines
  and rejects on the arithmetic rather than merely tripping a new invisibility guard. Confirmed in the database by the main session:
  `dos_journal_entry_balanced` is now `SECURITY DEFINER` with `search_path = public, pg_temp` (pg_temp LAST, so a temp table cannot shadow
  `journal_lines`), and the function also raises if it can see NO line for the entry, turning any future silent failure into a loud one.
- `journal_lines` and `journal_entries` policies narrowed to SELECT back-office / INSERT staff-minus-warehouse / UPDATE back-office, NO DELETE.
- New tables `write_offs` and `retailer_outstanding_summary` (a TABLE, not a view — PowerSync streams allow no GROUP BY); receipts gained the
  deposit, bounce and offline-dedupe columns; ageing gained the 61-90 and 90+ buckets; chart of accounts gained BANK_CHARGES and CASH_SHORT.
- `ReceivablesService` ships the COMPLETE interface from coordination §3.1 — every method billing, delivery and integrations will import.
- Demo data: 9 carried-over opening bills, 8 unallocated on-account receipts, 5 cheques (2 in hand, 2 banked, 1 returned with its reversal and
  bank charges), 3 part-payments carrying the offline device key, 4 trip cash collections, a keying-error reversal, 2 write-offs, 4 open
  cash-discount offers. The seed asserts every entry sums to zero and the rollup ties to the AR account, and throws if not. Real ageing spread
  confirmed in the database: 1,37,115 / 18,061 / 18,670 / 41,470 / 58,050 / 63,640 rupees across the six buckets, 3,50,626 total.
- Whole workspace green (48/48 turbo tasks); `pnpm smoke` **445 calls · 282 OK · 124 correct refusals · 0 BROKEN** (up from 369 calls).

**MODULE 2 OF 10 DONE — billing (2026-09-05 03:00), verified independently by the main session:**

- Invoices at pack (`issueForPack`, which warehouse calls at step 3 and which moves no stock and no order state), van-sale and brand-DMS
  invoices, credit notes, UPI QR, e-way bill entry, and the GSTR-1-shaped registers reporting and claims will consume. Migrations 0008/0009.
- **Object storage built for the WHOLE product** (`backend/libs/core/src/platform/object-storage.ts`, coordination §3.3): plain DI-free
  functions behind `OBJECT_STORAGE_DRIVER`. The `local` driver is the default and needs NO cloud account — it writes under `backend/.storage`
  (git-ignored) and signs its own URLs with HMAC. The `s3` driver implements SigV4 by hand in ~70 lines of `node:crypto` rather than pulling in
  the AWS SDK, and is tested against AWS's own published signing vectors with no network call. Keys are tenant-scoped and a key that escapes its
  tenant prefix is refused four different ways.
- **White-label keys are now fixed and exported as `TENANT_SETTING_KEYS`**: `branding.display_name`, `branding.logo_object_key`,
  `branding.invoice_footer`, `upi_vpa`. Convention set by 0009 and binding on every later module: any setting holding a credential is named
  `secret.<name>` and stays owner-only. This also fixed a real latent bug — under FORCE RLS every non-owner role read `tenant_settings` as EMPTY
  and silently treated every setting as unconfigured.

**INFRASTRUCTURE FIX FOUND WHILE VERIFYING (main session, not the agents):** the full test suite failed intermittently — billing's spec timed
out at 5 s while passing in 3 s alone. Cause: vitest runs spec files in parallel and each boots its own `DbModule`, so 13 spec files in
`@dos/core` at the default pool of 10 asked for 130 connections while the seven running dev services already held 70 of Postgres's 100. Specs
were STARVED, not slow. Fixed properly rather than by raising the timeout alone: `createPool` now honours `DATABASE_POOL_MAX` (`poolMax()` in
client.ts, default 10) and every test setup sets it to 3; the shared vitest preset also gets a 30 s test timeout because these are integration
tests against a real database. **This matters beyond tests — it is a scale rule: `replicas x DATABASE_POOL_MAX <= max_connections` (docs/20).**
Verified by three consecutive clean full runs.

- Whole workspace green three times in a row: **828 tests**, 48/48 turbo tasks, `docs:readme:check` and `format:check` in sync.
- `pnpm smoke`: **517 calls · 318 OK · 147 correct refusals · 0 BROKEN** (369 → 445 → 517 as modules land).

**CURRENT MODULE: warehouse (step 3 of 10)** — order queue, picklist, pick lines, pack (which takes over the invoice-issuing path from billing's
temporary `billing.invoices.issue`, per coordination §4's phased hand-over), load sheet, delivery challan. Migrations 0010/0011.

**Superseded: billing (step 2 of 10)** — workflow `wf_01bdaaa1-8b4`: invoices at pack (`issueForPack`), van-sale and brand-DMS invoices,
credit notes, UPI QR, GST registers, migrations 0008/0009, AND the object-storage platform (coordination §3.3) that receivables, warehouse,
delivery, docint, claims, reporting and integrations all assume and none of them builds. Local driver by default so it works with no cloud
account.

**Superseded: receivables (step 1 of 10)** — workflow `wf_67b45b30-9c3` running: migrations 0006/0007 (including the journal-balance
SECURITY DEFINER fix from coordination §5.2), the complete `ReceivablesService` interface every later module imports (coordination §3.1), the
contract + permissions, the module implementation, demo data, and `pnpm smoke` staying at 0 BROKEN.

**Earlier: work in flight when the session paused (background agents were killed by the sleep; re-run them):**

- `dos-working-swagger` workflow (run id `wf_1f65f5a0-dac`): phase 1 was mid-flight — `backend/libs/core/src/docs/examples.ts` (real OpenAPI
  examples built from seeded demo rows) and `backend/tools/smoke-endpoints.mts` (`pnpm smoke`, calls every endpoint of every service). Check what
  landed on disk before re-running; resume with the script in the session's workflows dir.
- `dos-design-research` workflow (`wf_f210275f-34d`): writing docs/design/UX-01-field-reality.md, UX-02-current-standards.md,
  UX-03-technical-constraints.md, then UX-00-design-system.md. Frontend only — does not block backend.
- One agent writing `docs/plans/00-coordination.md` (resolves the migration-number collisions between the ten module briefs — FOUR of them each
  claim `0006` — plus the shared services no module owns, the cross-module call graph, and the consolidated founder questions).
  **Verified working at the pause:** all seven services up on 3000-3006 with Swagger at `/swagger` and Scalar at `/docs`; login and the whole
  permission matrix proven live; owner app signs in at :5173 and lists 36 shops (fixed a doubled `/auth/auth/login` base URL in
  frontend/owner-app/src/lib/api.ts); whole backend green (48/48 turbo tasks); frontend green (9/9).
  **Founder answered the six expensive questions on 2026-09-04 23:40 — see `docs/17-corrections-from-review.md` §D for the answers and exactly what each one changes. Key ones: shops ARE GST-registered (B2B tax invoice is primary); only DELIVERY collects money plus the shop paying online, never the salesperson; NO separate van-sale numbering; invoice series is per-tenant configuration, never hard-coded; cash discount realised at receipt only; and the product is WHITE-LABELLED — each distributor sees their own name and logo in the app and on every document, so `tenant_settings` needs display name + logo and the design phase must prove it.**

**Remaining questions** — see `docs/plans/00-coordination.md` §7 once that agent's file exists, and the short list posted
in chat on 2026-09-04 23:20. Nothing is blocked on them: assumptions are recorded per brief and are cheap to change if the answer differs.

**MODULE 3 OF 10 DONE — warehouse (2026-09-05 07:50 IST), verified independently by the main session:**

- Migrations 0010 (generated: columns, indexes, and the five policy replacements — drizzle can express policies, so they live in the
  generated file; 0011 hand-written carries FORCE RLS, grants and a DO block that fails the migration if any of the five tables lacks
  FORCE RLS or still has a FOR ALL policy). Fresh-database migrate 0000→0011 proven.
- 20 procedures under `warehouse.*`: fulfilment queue, picklists (create / start / pick with FEFO warnings / cancel), packs (confirm =
  stock out once + order state + invoice issued through billing `issueForPack`), load sheets (create / confirm with PIN and count →
  transfer godown→vehicle, DC challan from the tenant `DC-` series, e-way bill gate above the intra-state threshold), challans,
  reservations. `billing.invoices.issue` is gone; a pack is the only way a sale invoice is issued. Orders gained the fulfilment surface
  (`applyFulfilmentEvent`, `recordPick`, `fulfilmentQueue`, `fulfilmentLines`).
- Mounted on owner :3001, manager :3002, warehouse :3004 (with billing), delivery :3005 (reads only). Not sales, not retailer.
- Whole workspace green: 48/48 turbo tasks forced, **962 tests** (core 223 incl. 30 warehouse cases), `docs:readme:check`, `format:check`;
  `pnpm smoke` **610 calls · 362 OK · 186 correct refusals · 0 BROKEN · 62 skipped** (up from 517).
- One test race fixed by the main session: `examples.spec` probed free ids in the owner lane while the owner-service spec, running in
  parallel under turbo, created rows in that lane. The spec now takes the spare lane (`SPARE_LANE`). Not a product defect.
- Open item carried to the platform-gaps slice: a cancelled pack invoice cannot be re-billed (`pack_confirmations` is unique per order);
  `billing.invoices.issueForPack` for a parked pack is in docs/23 §8.2.

**MODULE 3b OF 10 DONE — platform-gaps (2026-09-05 10:40 IST), verified independently by the gate agent:**

- What landed: the 38 procedures docs/23 §8.1–8.3 and §8.11–8.19 asked for, plus a NEW `files` module (`uploadUrl` STAFF per domain,
  `readUrl` ANY_MEMBER following the owning row's RLS; the local driver now pre-signs a PUT to `/storage/{key}` on every service so an upload
  on one Mac is the S3 flow), the dependency-free PDF renderer (`@dos/core/documents` + worker job `documents.pdf.render`: invoice A4/A5/thermal
  with three copies, credit note, Rule 55 challan, receipt; white-labelled from `tenant_settings`; every `*.pdf` procedure answers `ready` +
  signed URL once rendered — proven by the gate: a shop's `invoices.pdf` on :3006 serves `application/pdf`, another shop's `files.readUrl` on the
  same key is 403), tenancy settings/branding/numbering/feature flags/audit/staff.update, auth forgot/reset password (Ed25519 token bound to
  the password hash, no table), `sync.errors.list` + `sync.pull`, receivables for the salesperson (dues + credit check of own-beat shops,
  never a receipt), `billing.invoices.issueForPack` for a parked pack, `warehouse.loadSheets.approve` (manager app) + `confirm` for the
  warehouse phone, retailer `orders.submit` / `updateOwn` / `schemes.list` / `bargains.list`, cycle counts, discrepancies.resolve, supplier
  invoice dispute/cancel, rep authorisations, tenant brands, pack configs. Accountant narrowed to MONEY_DESK + reads. Migrations 0012/0013.
- Gate verification: 48/48 turbo tasks forced, **1254 tests** (two consecutive runs), `docs:readme:check`, `format:check`; `pnpm smoke`
  **844 calls · 0 BROKEN**; `pnpm smoke --destructive` 844 · 0 BROKEN → `pnpm db:seed` → `pnpm smoke` 844 · 0 BROKEN; `pnpm db:seed` twice
  = identical counts on all 126 tables; every service's `/health` and `/docs/openapi.json` match coordination §6.
- Defects found by the gate and fixed (each with a test so it cannot return):
  1. `receivables.writeOffs.create` answered **500** when a second desk sent an id that already existed (the documented example pressed on
     the owner and then the manager service): now a 409 `write-off … already exists`, spec case added; the example walks free id slots per
     service lane like orders do.
  2. `billing.invoices.issueForPack` under an invoice id that already names a bill answered the misleading "already billed, or document
     number … booked" 409: now `invoice … already exists` (constraint-named), warehouse spec extended; the example walks free invoice-id slots
     and prefers a parked pack that actually moved stock — the smoke now exercises the happy path (both parked packs billed 200).
  3. Swagger examples for `allocations.remove` and `invoices.cancel` carried the sampler's made-up uuid (`{id}` and `restockLocationId`), so
     "Try it out" was a permanent 404: `examples.ts` now reads a removable allocation and a real invoice, and returns goods to the real
     godown; `examples.spec` asserts all three.
  4. `pnpm db:seed` FAILED (`retailer_outstanding_summary nets to … but the AR account balance is …`): the in-flight delivery seed booked a
     full doorstep payment for bills the receivables seed had already settled on this database (INV/0023, 0027, 0031, 0067 were allocated
     twice). `seed-demo/delivery.ts` now collects at the door only where no other money is against the bill (its draw sequence unchanged, so
     re-seeding stays a no-op) and numbers doorstep receipts by bill, not by position. The four double-booked receipts on the founder's
     database were reversed THROUGH THE PRODUCT (`receipts.reverse` as the owner: mirror receipts, append-only journal) — nothing was
     deleted; their `collections` rows and the settlements' UPI totals still show the money the crew reported.
- Carried forward (not this slice's): the reset-token delivery channel (notifications), the outbox relay must register `handlePdfRenderJob`
  when docint builds the registry (today the worker polls `DocumentRenderRequested` itself), JPEG-only logos, `file_objects.status` flips to
  `uploaded` only on the local driver (S3 needs a bucket notification or `files.confirmUpload`), and `warehouse.packs.confirm` on an order that
  holds no stock records a 100 % short pack that can never be billed (`issueForPack` refuses "moved no stock") — the seed's SO-0116/0117/0119
  are confirmed without reservations; decide whether a pack with nothing held should be refused (docs/plans/00-coordination.md §7).

## Earlier resume notes (session 3, 22:10 IST)

1. `brew services list | grep postgresql@17` must say `started`. Node 24: `export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24`.
2. Two pnpm workspaces: `cd backend && pnpm install && pnpm db:migrate && pnpm db:seed`; `cd frontend && pnpm install`. Build `@dos/contracts` and `@dos/domain` in backend before any frontend work (the apps link them).
3. **AUTH IS DONE (2026-09-04).** Username + password, our own token service. Every service now requires `Authorization: Bearer <jwt>`; the `x-tenant-id`/`x-actor-id`/`x-actor-role` headers are GONE. Sign in at `POST http://localhost:3000/auth/login`; demo password for every seeded user is `Dos@1234` (usernames in the table below). Permission matrix per endpoint lives in `backend/libs/contracts/src/permissions.ts`, is enforced by `TenantGuard`, rendered in every README and `/docs`, and tested by `describePermissionMatrix` in every service spec (every endpoint × every role).
4. **CURRENT WORK: finish the backend completely before any frontend work** (founder, 2026-09-04 22:30: "continue with all backend services, test all endpoints again, see if desired results are coming, if not fix them till everything in backend is perfect; once done notify me, then we move to frontend").

   4a. Swagger/API console must be usable by hand: every operation carries a REAL example built from the seeded demo rows (never `string` or the placeholder uuid), and pressing Execute succeeds. Built by `backend/libs/core/src/docs/examples.ts` + `backend/tools/smoke-endpoints.mts` (`pnpm smoke`), which calls every operation of every service with a real token and exits non-zero on anything broken.

   4b. The remaining ten modules, one at a time to "stable". **READ `docs/plans/00-coordination.md` FIRST — it is the coordination contract** and it overrides any single brief where they disagree. A dedicated pass found that the ten briefs, written independently, collided badly: SIX of them claimed migration `0006`, three claimed numbers already used, seven shared services (object storage, export jobs, PDF rendering, the outbox registry, CSV writing, the replica pool, the ledger surface) were each going to be built two or three times, billing and warehouse would both post the stock movement and both advance the order so stock left twice, and several briefs restated facts about the code that are no longer true. All of that is resolved in that document: migrations are assigned uniquely 0006–0024, every shared service has ONE named owner and a fixed signature, and the ledger surface is one `ReceivablesService` with a fixed method list.

   **It also caught a real hole nobody had spotted.** The trigger that guarantees every money entry balances (`dos_journal_entry_balanced`, migration 0003) is NOT `SECURITY DEFINER`, and `journal_lines` has FORCE row-level security, so the trigger's own `SELECT SUM(...)` obeys the caller's policy. Today the policy is tenant-wide, so it works. The moment receivables narrows reads to back-office only — which its brief proposes — a delivery worker recording a doorstep payment would insert lines the trigger cannot see, the sum would read zero, and **an unbalanced money entry would commit silently**, for exactly the roles that handle cash. Verified against the live database: the function has no `SECURITY DEFINER` and `journal_lines_tenant` is the only policy. The fix is `SECURITY DEFINER SET search_path = public` in migration `0007`, with a new case in `rls.test.ts`. Do not narrow those policies without it.

   **CORRECTED BUILD ORDER** (integrations moved from 9 to 6, because claims and reporting both need its `export_jobs` table and would otherwise each build their own):
   1. receivables — the ledger surface every money module calls, receipts, allocations, ageing, outstanding, write-offs (migrations 0006/0007, including the trigger fix)
   2. billing — invoice at pack, credit notes, UPI QR, GST registers; also builds OBJECT STORAGE for everyone (0008/0009)
   3. warehouse — order queue, picklist, pack, load sheet, delivery challan; takes over posting the sale and advancing the order from billing (0010/0011)
   4. delivery — trips, stops, POD, doorstep collections, van sales, expenses, settlement, `/gps/points`
   5. docint — bill scanning to GRN; also builds the OUTBOX RELAY handler registry (the relay is a no-op stub today)
   6. **integrations** — the generic mapped importer (see §D row 7), Tally export, FieldAssist import; also builds `export_jobs` + the export queue for everyone
   7. claims — scheme, damage and expiry claims to brands
   8. notifications — WhatsApp/SMS adapters, event-driven sends, templates, broadcasts
   9. reporting — dashboards, registers, the CHART SERIES the owner app needs; also builds CSV writing and the `DATABASE_REPLICA_URL` second pool
   10. incentives — plans, targets, slabs, statements

   4c. Then demo data for three distributors with staff under each and shops linked to two of them; `DATABASE_REPLICA_URL` second pool + the ledger partition plan (docs/20). THEN notify the founder and start the frontend.

5. Then: demo data for three distributors + shops linked to two of them; `DATABASE_REPLICA_URL` second pool + ledger partition plan (docs/20). Only then the six frontend apps.
6. Founder 2026-09-04 21:20: the owner app must have GRAPHS wherever possible (growth, how the distributorship is performing) — the reporting module serves chart-ready time series.
7. Before ending a session: update this block + the table, `pnpm format` in both workspaces, `pnpm docs:readme` in backend, `git add -A`, hand the founder the commit command.

Rule reminders: subagents never permanently edit `backend/libs/contracts/src/contract.ts`, module `index.ts` files or `service.ts` — the main session wires. Migrations are EXPAND-ONLY from 0004 onward (0004 auth + warehouse role, 0005 auth guarantees). Generated READMEs are prettier-ignored so `format:check` and `docs:readme:check` cannot disagree.

## Local links (`.claude/launch.json` entries, or the commands in CLAUDE.md "Run things")

Sign in first: `POST http://localhost:3000/auth/login` with `{"username":"sunil.tarsun","password":"Dos@1234","deviceId":"<any uuid>"}`, then send `Authorization: Bearer <accessToken>`.

| Service   | Swagger UI                    | Scalar                     | OpenAPI                                 | Roles served        |
| --------- | ----------------------------- | -------------------------- | --------------------------------------- | ------------------- |
| auth      | http://localhost:3000/swagger | http://localhost:3000/docs | http://localhost:3000/docs/openapi.json | everyone (sign-in)  |
| owner     | http://localhost:3001/swagger | http://localhost:3001/docs | http://localhost:3001/docs/openapi.json | owner               |
| manager   | http://localhost:3002/swagger | http://localhost:3002/docs | http://localhost:3002/docs/openapi.json | manager, accountant |
| sales     | http://localhost:3003/swagger | http://localhost:3003/docs | http://localhost:3003/docs/openapi.json | salesperson         |
| warehouse | http://localhost:3004/swagger | http://localhost:3004/docs | http://localhost:3004/docs/openapi.json | warehouse           |
| delivery  | http://localhost:3005/swagger | http://localhost:3005/docs | http://localhost:3005/docs/openapi.json | delivery            |
| retailer  | http://localhost:3006/swagger | http://localhost:3006/docs | http://localhost:3006/docs/openapi.json | retailer            |

Apps (universal — website + Android + iOS from one Expo codebase each; docs/08 §0). Generate one from the
skeleton first: `cd frontend && pnpm --filter @dos/app-template new <role>` then `pnpm install`.

| App          | Web                   | Command (`cd frontend`)                | Service |
| ------------ | --------------------- | -------------------------------------- | ------- |
| app-template | http://localhost:5170 | `pnpm --filter @dos/app-template web`  | :3001   |
| owner        | http://localhost:5173 | `pnpm --filter @dos/owner-app web`     | :3001   |
| manager      | http://localhost:5174 | `pnpm --filter @dos/manager-app web`   | :3002   |
| sales        | http://localhost:5175 | `pnpm --filter @dos/sales-app web`     | :3003   |
| warehouse    | http://localhost:5176 | `pnpm --filter @dos/warehouse-app web` | :3004   |
| delivery     | http://localhost:5177 | `pnpm --filter @dos/delivery-app web`  | :3005   |
| retailer     | http://localhost:5178 | `pnpm --filter @dos/retailer-app web`  | :3006   |
| admin        | http://localhost:5179 | `pnpm --filter @dos/admin-app web`     | :3007   |

`… ios` and `… android` run the same app on a simulator or a device. The kit's gallery (every component,
every state) is `pnpm --filter @dos/ui gallery` → http://localhost:5199.
Database in DBeaver / pgAdmin: 127.0.0.1:5439, db `dos`, user `dos`, password `dos` (steps in `docs/21-local-database-setup.md`).

### Demo sign-in (every password is `Dos@1234`), tenant Tarsun Enterprises

| Role        | Name           | Username       |
| ----------- | -------------- | -------------- |
| owner       | Sunil Tarsun   | sunil.tarsun   |
| manager     | Vikas Kadam    | vikas.kadam    |
| accountant  | Meena Joshi    | meena.joshi    |
| warehouse   | Dinesh Patil   | dinesh.patil   |
| salesperson | Rahul Deshmukh | rahul.deshmukh |
| salesperson | Amit Pawar     | amit.pawar     |
| salesperson | Pooja Shinde   | pooja.shinde   |
| delivery    | Ganesh More    | ganesh.more    |
| delivery    | Raju Yadav     | raju.yadav     |
| retailer    | Ramesh Gupta   | ramesh.gupta   |
| retailer    | Fatima Shaikh  | fatima.shaikh  |

### Platform console sign-in (admin-service :3007) — NO tenant, its own endpoint

`platform_admin` is not a membership role: these two accounts belong to no distributor, so `/auth/login` refuses
them by design and the six role services answer 403 at the gate. Sign in at
`POST http://localhost:3000/auth/platform/login` with `{"username":"dos.admin","password":"Dos@1234","deviceId":"<any uuid>"}`,
then call :3007 with the bearer token. Password `Dos@1234` for both.

| Level     | Name                         | Username      | What it is for                                                                                                                                                                   |
| --------- | ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `super`   | Rohit Nair (Distribution OS) | `dos.admin`   | Onboard a distributor, set plans and subscription state, suspend/reactivate, read the audit trail                                                                                |
| `support` | Anita Rao (Distribution OS)  | `dos.support` | The person who ASKS for support access; each of the three distributors has one of her requests pending, waiting for its own owner to answer on :3001 (`tenancy.support.approve`) |

The other two distributors sign in on the same six services with their own staff — `prakash.salunkhe` (owner, Sai
Distributors) and `nitin.bhoir` (owner, Kalyan Agencies); `pnpm db:seed` prints all three sign-in tables.

## Status by module

| Module                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Backend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | App screens                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| platform (tenancy, idempotency, sync, outbox, retention, storage)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | after backend                                                                                                                                     |
| auth (username + password, tokens, permission matrix)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ verified (2026-09-04)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | after backend                                                                                                                                     |
| catalog + tenant-catalog · retailers · pricing · inventory · procurement · orders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | after backend                                                                                                                                     |
| 1 receivables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ verified (2026-09-05)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | after backend                                                                                                                                     |
| 2 billing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ verified (2026-09-05)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | after backend                                                                                                                                     |
| 3 warehouse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ verified (2026-09-05, 962 tests, smoke 610/0 broken)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | after backend                                                                                                                                     |
| 3b platform gaps (docs/23 in built modules, files + PDF, accountant scope, manager load-sheet approval)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ verified (2026-09-05, 1254 tests, smoke 844/0 broken)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | after backend                                                                                                                                     |
| 4 delivery (vehicles + consents, trips, stops, doorstep deliveries + POD, collections, van sales, expenses, settlement, GPS; migrations 0014/0015; 32 procedures on owner/manager/warehouse/delivery/retailer; sync handlers for trip_stops, deliveries, pod_evidence, collections, trip_expenses; seed-demo `delivery-road.ts`; gate fixes: turbo `concurrency: 4`, delivery spec fixtures in a hook, `packConfigs.upsert` id clash → 409 + self-healing example, smoke `trips.cancel` on its own throwaway plan)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ verified (2026-09-05, 1442 tests, smoke 1004/0 broken ×3, seed idempotent over 126 tables)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | after backend                                                                                                                                     |
| 5 docint (inbound-bill pipeline: capture → QR decode/verify → engine → validators → SKU cascade → single-writer review → approve into a supplier-invoice DRAFT via procurement's new `SupplierInvoiceService.createInTx`, never stock/lot/cost/journal; `documentMachine` + `reviewSessionMachine` in @dos/domain; 26 procedures on owner/manager/warehouse; `@dos/core/docint` DI-free pipeline subpath with a deterministic stub engine and a raw-HTTP Anthropic vision adapter (`DOCINT_ENGINE`, `DOCINT_INLINE_JOBS`); sync handlers for documents + document_pages; worker: real outbox relay (`registerOutboxHandler`, `FOR UPDATE SKIP LOCKED`, backoff, dead-letter — migration 0020) + pg-boss queues docint.qr-read/extract/validate/match; seed-demo `docint.ts` 11 documents in every state)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ verified (2026-09-05, 1550 tests ×2, smoke 1082/0 broken ×3 incl. --destructive, seed idempotent over 127 tables, worker booted live: 1145 renders + 104 docint events relayed, 0 dead-lettered)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | after backend                                                                                                                                     |
| 6 integrations (the GENERIC mapped importer, docs/17 §D7: upload → create → preview → map/save profile → dry run → review → commit → confirm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | rollback, CSV + XLSX (dependency-free reader/writer), five targets party_master / item_master / opening_outstanding (owner-only, bill by bill, balanced OPENING entries) / sales_register (no ledger effect) / brand_dms_invoices (one bill per invoice number, no stock, overlaps skipped); built-in vendor profiles as data (TradeEzee, Marg, Busy, Tally, FieldAssist); matching by external code → phone/GSTIN → trigram name, EAN → alias → name, never a guess; per-row commit transactions keyed `import:<job>:<rowNo>` with before/effects snapshots and a one-transaction rollback through `invoiceMachine` + mirror journals; `importJobMachine` in @dos/domain; the single `export_jobs` owner + `exports.render` renderer registry (`registerExportRenderer`): Tally XML with brand-DMS lines excluded and stable GUIDs in `tally_sync_ledger`, GSTR-1 JSON, sales-register / outstanding XLSX + CSV twins, e-way / e-invoice JSON stubs; Tally mappings; 21 procedures on owner + manager (accountant reads + exports); migration 0023; worker queues `imports.run` / `exports.render` + minute sweep, `INTEGRATIONS_INLINE_JOBS`; seed `integrations.ts` 8 jobs in every state with real files in the object store, 40 purchase-history rows, external codes, Tally mappings, a rendered Tally export + sync rows, 2 queued exports; gate fixes: `claims.evidence.attach` docs example, `imports.cancel` on a throwaway import + parsed-file fallback for the wizard example) | ✅ verified (2026-09-05, 1626 tests ×2 then 1627, smoke 1124/0 broken ×3 incl. --destructive, seed idempotent over 128 tables)                    | after backend |
| 7 claims (money the brand owes the distributor: policies per brand (`return_policies` + `tenant_brands.claim_channel`), periods, open → build → lines (add / adjust / remove) → evidence → submit (CLAIM series, accrual Dr SCHEME_RECEIVABLE or CLAIMS_RECEIVABLE) → acknowledge → settlements (credit note / bank / cheque / goods / adjustment, allocated to lines with `allocate()`) → reject (true reversal) / write-off (Dr BAD_DEBTS, owner + accountant) / cancel (draft only); `build.service.ts` reconstructs scheme lines from `invoice_lines.applied_rules` (company-funded, claimable, the claim's channel, never cash discount; free goods at PTD; credit notes scale the claimable qty), damage / expiry from credit notes + `damage` / `expiry_writeoff` ledger rows at the policy basis with the lot's own case size, shortage / rate difference from open gate-count findings (marked `claimed` at submit); brand_dms claims numbered and exported but never journalled; ageing, chart-ready register, bounded reconcile; claim-sheet snapshots rendered by the `claim_sheet` renderer on integrations' `exports.render` registry (brand column sets, distributor's own name); `claimMachine` in @dos/domain; 23 procedures on owner + manager; migrations 0021/0022 (DB slice) + 0026 (`cancelled`, `cheque`, index rebuilt); seed `claims.ts` 7 claims in every state; gate fixes: `seedPendingVanSaleOrder` after `seedWarehouse`, deterministic godown pick in `seedStock`, shop names on seeded sheets, new fresh-database seed spec)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ verified (2026-09-05, 1702 tests ×2 then 1703 ×2, smoke 1170/0 broken ×3 incl. --destructive, seed idempotent over 129 tables on the founder's DB AND on a fresh one, worker rendered the queued sheet)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | after backend                                                                                                                                     |
| 8 notifications (every WhatsApp / SMS / push / in-app row the platform ever sends: 14 procedures on ALL SIX role services (messages list/get/send/resend/markRead, templates list/upsert, broadcasts create/list/get, pushTokens register/unregister, inbound list/markHandled); QUEUE-THEN-DISPATCH — a send is one `messages` row whose payload is frozen at queue time with the white label (`distributorName` / `senderName` from `branding.display_name`, `upiLink` from the tenant's `upi_vpa`), the provider call happens later in the worker; channel per shop (WhatsApp only with `whatsapp_optin_at`, else SMS, blocked link = opted out, no phone = skipped and reported), locale chain `retailer_links.preferred_lang` → `notifications.default_locale` → `en-IN` with an English fallback; deterministic idempotency keys `<EventType>:<aggregateId>`; providers behind `MessageProvider` (deterministic stub by default and always under NODE_ENV=test, Meta WhatsApp Graph v21.0 and MSG91 v2 env-gated, nine unit tests on an injected fetch — no test touches a network); outbox translators for OrderConfirmed/OrderCancelled/OrderSubmitted/InvoiceIssued (brand-DMS and imported bills ignored)/DeliveryRecorded/ReceiptRecorded/retailer.identity_linked plus per-stop delivery-today and a once-per-7-days dues reminder; dispatch sweep with `FOR UPDATE SKIP LOCKED`, backoff 1m/5m/30m/2h/12h and a dead letter at five attempts, broadcast counters refreshed per batch; retailers gained `contactPreferences` / `contactPreferencesFor`; migrations 0024/0025 (DB slice); seed `notifications.ts` — 21 platform templates, one Tarsun override, ~200 messages on real orders / bills / deliveries / receipts, a broadcast, a dead letter, push tokens, inbound texts; gate fixes: the dispatch sweep gained a `tenantIds` scope (its spec was claiming other tenants' 1,400 due rows on the founder's shared database and never reaching its own), a deterministic tie-break on the seed's `deliveries` / `receipts` LIMIT queries (a LIMIT over tied timestamps is not a stable order, so a second seed of a FRESH database added two message rows), turbo `concurrency: 2` (macOS was killing tsc / eslint / vitest mid-run at 4), and the owner app's scheme union narrowing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ verified (2026-09-05, 1826 tests ×2, smoke 1254/0 broken ×4 incl. --destructive, seed idempotent over 131 tables on the founder's DB AND on a fresh one, 14 notifications operations 200 on every one of the six services, worker booted live: 1000 outbox rows relayed and 200 messages dispatched per tick, 0 failed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | after backend                                                                                                                                     |
| 9 reporting (the read model behind every dashboard, graph and register: 33 procedures on owner / manager / sales / warehouse / delivery — **never retailer, never auth**; `dashboard.owner` + `dashboard.rep`, the 16-strong `series.*` family the founder's graphs need (day/week/month grain, `previousPeriod` / `previousYear` compare, groupBy brand / category / beat / salesperson / paymentMode with an `other` fold, every bucket of the window present and zero-filled, a flow SUMMED and a stock the bucket's LAST day, a ratio recomputed from the summed numerator and denominator), `dailyStats.tenant/rep`, the three retailer surfaces (`behaviour`, `series`, `lapsed`), eight registers (rep productivity, scheme spend, stock value, fill rate, delivery performance, collections, GSTR-1 sales — billing's own `gstSummary` wrapped so the tax arithmetic exists once — and GSTR-2 purchase) and async CSV/JSON exports as twenty `report_*` renderers on integrations' ONE `exports.render` registry; six rollup tables read in exactly one file (`reporting.queries.ts`), every other number through the owning module's exported read (orders `fillRateLines`, inventory `valuationByLocation`, procurement `purchaseRegister`, receivables `collectionsRegister` / `outstandingList` / `ageingHistoryFor`, retailers `beatAssignmentsFor`, tenancy `userLabels`, delivery `deliveryPerformanceRows`); cost is a hard boundary — `series.grossMargin` OWNER_ONLY, `stockValue` / `series.stock` / `dashboard.owner` back office, and a salesperson reads 0 rows of `daily_owner_stats` at the database; a field role's own-scope filter is FORCED, never 403'd; `DATABASE_REPLICA_URL` platform support (`DB_REPLICA` resolves to the same client as `DB` while unset — every reporting GET reads it, every write stays on the primary); worker `reporting.rollup.schedule` every 15 min fanning out one job per tenant, `reporting.rollup.tenant`, `reporting.rollup.finalize` 00:20 IST; seed `reporting.ts` backdates 400 days of rollup rows plus 4 export jobs, `seed-demo/sales.ts` short-picks ~6% of lines so fill rate is not a flat 1.0; NO new migration — the DB slice's 0027/0028 sufficed; gate fixes: the three registers ordered for the reader (worst fill rate first, biggest scheme spend first, trips by date) paged with a keyset cursor on an id they are not sorted by and silently dropped rows — fill rate answered 29 variants in one page and 5 when walked, scheme spend 72 against 11, and the CSV export walked the same cursor so the file was short too; they now page by offset (`pageByOffset`) with a spec that walks every register one row at a time, plus the two missing brief §5 cases (scheme-spend funding split with a cancelled bill excluded, GST purchase counting only `received` supplier bills) and the incentives contract's payout-slab doc example)                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ verified (2026-09-05, 2040 tests ×2, 48/48 turbo tasks, smoke 1419 calls · 0 BROKEN ×4 incl. --destructive, seed idempotent over 131 tables, worker's 15-minute rollup wrote today's row live, every register pages exactly and its CSV carries every row)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | after backend                                                                                                                                     |
| 10 incentives (what a rep is aiming at, how far along they are and what that would pay — **compute only, never payroll**: no series, no GST, no journal entry, no “mark disbursed”; 14 procedures on owner / manager / sales / delivery and **zero on warehouse and retailer** — targets upsert / bulkAssign / get / list / remove / refresh / whatIf, progress mine / team, statements compute / approve / reopen / get / list; the slab evaluator is PURE and lives in `@dos/domain/src/incentives/slabs.ts` (`evaluatePayout`, `matchSlab`, `achievedPctBps`, `slabPayoutPaise`, 17 unit tests), so `targets.whatIf`, `statements.compute` and the worker sweep are one implementation and an owner tuning slabs on screen can never disagree with the statement struck at month end — only the slab REACHED (never cumulative), nothing below the lowest, no extrapolation above the open-ended top one (coordination §7 q32); the achievement cache is WORKER-ONLY by the database (`achievements_write` names `system` alone and migration 0030 asserts no desk role can ever be added), so `targets.refresh` writes an `IncentiveAchievementRecomputeRequested` outbox row and answers `{status:'queued'}` instead of escalating `app.actor_role`, and the worker writes under `tenantStorage.run(systemCtx(tenantId), withTenant(…))` — RLS still scopes every read and write to that one distributor, never `app_worker`'s BYPASSRLS across tenants; three new plain cross-module functions per coordination §3.9 / §4 instead of raw SQL (`orders.salesAggregate`, `retailers.visitCount`, `receivables.collectedByUser`), each windowed on the BOOKING instant `coalesce(confirmed_at, created_at)` and `salesAggregate` crediting `created_by` when an order names no rep, which is what makes a delivery crew member's van-sale target work at all; `@dos/core/incentives` worker subpath (`sweepAchievements`, `recomputeAchievement`) driving an hourly `incentives.achievements.sweep` bounded at 5,000 targets on a `(tenant_id, id)` cursor, one transaction per distributor, closed periods deliberately skipped; seed `seed-demo/incentives.ts` — five open targets mid-period, a sixth behind the van-sales flag, one approved and one pending statement, every figure recomputed from the rows the earlier seeds wrote; NO new migration — the DB slice's 0029/0030 sufficed, and rls.test.ts already carried its four cases; gate fixes: the docs id-slot pickers for `procurement.supplierInvoices.create` and `tenancy.staff.create` probed a SINGLE 256-slot window while `freeSlots` walked sixteen — the founder's database had spent all 256 invoice slots, so the fallback republished `DOCS/26-27/0257`/`0258` and `pnpm smoke` was permanently **2 BROKEN**, with staff seven slots from the same wall; both now go through one `walkFreeSlots`, and a new spec checks EVERY service lane's id, document number, username and phone rather than only the spare lane that sat past the used range and stayed green; and `targets.remove` cleared the worker-only cache row before the delete without putting it back when the delete then refused — the hourly sweep only revisits OPEN periods, so a closed one would have sat at 0 and `statements.compute` reads the cache, paying the rep short with nothing on screen saying why) | ✅ verified (2026-09-06, 2136 tests ×2, 48/48 turbo tasks, smoke 1475 calls · 0 BROKEN ×3 incl. --destructive with the 56 incentives calls all 200 or an expected 403, seed idempotent over all 131 tables, `db:generate` “No schema changes”, worker path run under tsx: 21 tenants / 74 targets swept and a single recompute reproducing the API's figure exactly)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | after backend                                                                                                                                     |
| 11 three distributors + shared shops demo, ledger partition plan (founder requirement docs/22 §8 2026-09-04: three distributors, staff under each, shops linked to more than one). `pnpm db:seed` now writes **Tarsun Enterprises** (pilot, unscoped ids so every `/docs` example, spec and smoke row is byte-identical to before), **Sai Distributors** (Dombivli East, `SAI/`, plan starter, 26 listed SKUs) and **Kalyan Agencies** (Ulhasnagar, `KA/`, plan growth, 24 SKUs), each with its own owner / manager / accountant / 2 warehouse hands / 3 reps / 4 drivers, beats, price lists, schemes, suppliers, costs and a month of orders, invoices, receipts, trips and deliveries (`seed-demo/tenants.ts`, `depth: 'core'`). `demoId()` gained a **scope** (`inDemoScope`, `currentDemoScope`; `GLOBAL_KINDS` keeps the curated catalog unscoped per ADR 0005) and `seedPeople` / `seedRetailers` / `seedDemo` a `PeopleRoster` / `RetailerNetwork` / `scope,label,roster,network,brandKeys,depth` — defaults reproduce the pilot exactly. **Ten shops sit on more than one distributor's books** (one `retailer_identities` row, a `retailers` + `retailer_links` row per tenant), five of them on all three; `ramesh.gupta` is ONE platform user with **three** memberships and `fatima.shaikh` with two, so switch-distributor has something to switch between. Identity ids are resolved **by phone after the insert**, so a shop already onboarded through a live `retailers.linkIdentity` keeps the id it has. `seriesPrefix()` (new, `db-helpers.ts`) makes the seeded invoice / credit-note / order numbers read the tenant's own `numbering_series` instead of a literal `INV/` (docs/17 §D1); white-label `branding.display_name` + `branding.invoice_footer` per tenant (docs/22 §9 rule 10). docs/20 gained the **ledger partition plan** addendum (hash-on-tenant for `stock_ledger` / `journal_lines`, monthly range for `trip_points`, `outbox_events`, `audit_log`, `sync_ops`, six-step online cut-over, retention per partition). **No migration, no contract, no permission change.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ verified by the independent gate (2026-09-06, **2137 tests ×2**, 48/48 turbo tasks `--force`, `docs:readme:check` + `format:check` clean in both workspaces, frontend 9/9, **smoke 1475 calls · 0 BROKEN ×3** incl. `--destructive` then reseed, `db:seed` twice **identical over all 131 tables**, `db:migrate` a no-op at 31 migrations and `db:generate` "No schema changes"). Live on the founder's database: each owner sees only its own shops (`R-` / `SD-` / `KA-`), a Sai owner asking for a Tarsun retailer id gets **404** (RLS, not a filter), a Sai rep gets **403** on stock value, `ramesh.gupta` switches between all three and reads 15 / 4 / 4 bills under the right white-label name each time, and every tenant's journals balance with **AR == the outstanding rollup** (₹4,59,863 / ₹2,36,397 / ₹2,31,232). Carried: Sai's and Kalyan's HISTORICAL bills on this machine still read `INV/…` (seeded minutes before `seriesPrefix()` landed; the seed is idempotent by row id and an issued invoice is immutable, so only a fresh database fixes it — `numbering_series` is already `SAI/` / `KA/`, so every bill the services issue from now on is right, and the new spec proves a fresh database is right throughout).                                                                                                                                                                                                                                           | after backend                                                                                                                                     |
| 12 ai (the four assistive surfaces the founder put in v1, docs/22 §8 2026-09-05 — **nothing here decides anything**: a shop's free-text WhatsApp message or a rep's spoken sentence becomes a DRAFT order a human always confirms; demand forecasting turns the stock ledger into a reorder suggestion for purchase planning; a trip's stops are sequenced by distance and time windows with the driver free to override. 11 procedures on ALL SIX role services (`intake.parseText/transcribe`, `drafts.list/get/confirm/reject`, `forecast.run/list`, `routing.plan/get/apply`); pure `planRoute()` (haversine → nearest neighbour → 2-opt, soft time windows, ETAs) in `@dos/domain/routing`; `platform/llm.ts` with an `anthropic` driver and a rule-based `deterministic` one that runs under `NODE_ENV=test` / empty `ANTHROPIC_API_KEY` and is carried as a REQUIRED fallback on every request, so no spec and no smoke probe ever opens a socket and a model outage never loses a shopkeeper's order; the model reads LANGUAGE and the DATABASE decides the SKU (the model never sees an id); a confirmed draft becomes an order only through `OrdersService.insertDraft → writeLines → submitInTx` and `routing.apply` moves stops only through `TripsService.reorderStopsInTx`, so pricing, credit, MOV, approvals and every stop refusal are unchanged; migrations 0031/0032 + the gate's 0035–0037; worker forecast pass on demand and nightly 03:40 IST; `seed-demo/ai.ts` (4 drafts, reorder suggestions, one unapplied route plan). Gate fixes: `route_plans_read` now admits **warehouse** (the matrix grants `ai.routing.get` to the godown, which had been reading `item: null` for ever) and `route_plans_insert` the **crew of that very trip**, so `RoutingService.plan` writes as the driver instead of escalating to `system`; the owner's half of platform support access (`tenancy.support.list/approve/revoke`) implemented, which the platform-console contract slice had declared with no handler — it was 404ing every route and failing 3 cases in all six service permission matrices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ verified by the independent gate (2026-09-06, **2300 tests ×2**, 48/48 turbo tasks, `pnpm smoke` 1562 calls · **0 BROKEN** across five runs including `--destructive` + reseed, seed twice identical across 138 tables, `db:generate` clean at 37 migrations)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ⏳ after backend                                                                                                                                  |
| 13 platform-admin (the seventh app's service, founder decision 2026-09-05 docs/22 §2 row 7 and §8: "organisation onboarding, plans and subscription state, support-access grants — time-boxed, owner-approved, audited"). **`admin-service` :3007**, the only service whose `roles` list names `platform_admin` and the only one that mounts the `admin` key; the mirror holds too — a console token is refused at the gate on all six distributor services. 15 procedures (`tenants.create/list/get/suspend/reactivate`, `subscriptions.upsert/list/get`, `support.request/list/revoke`, `users.list/disable`, `metrics.overview`, `audit.list`). **Sign-in is its own** (`auth.platformLogin/platformRefresh/platformMe`): a console account holds no membership, so `/auth/login` answers "use POST /auth/platform/login" and the tenant refresh and switch-tenant refuse a console session. **`admin.tenants.create` is the one procedure in the product that creates a tenant** — tenant row, `bootstrapTenant()` (accounts, locations, numbering series), the first OWNER login with `mustChangePassword`, and a trial subscription, in one idempotent call. **Suspension is real**: `tenants.status = 'suspended'` makes every sign-in AND every refresh for that distributorship answer **423** with a sentence naming who to call. **Support access, the founder's three words, one mechanism each** — TIME-BOXED (`dos_support_grant_guard` caps the window; the pass lives 5 minutes or until the grant ends), OWNER-APPROVED (there is deliberately no `admin.support.approve`; only `tenancy.support.approve` on owner-service opens one, and the database refuses a `platform_admin` actor writing the approval columns), AUDITED (`auth.supportPass` mints a signed `x-support-grant` header that `TenantGuard` verifies synchronously, acts as that tenant's owner narrowed to GET while the scope is read-only, and `SupportAuditInterceptor` files one `platform_audit` row per call). **The console reads counts, never trade**: `counts.ts` is COUNT/MAX/SUM-of-bytes only, and a console session runs with `app.tenant_id = ''` so every tenant policy matches nothing (proved in `rls.test.ts`). Migrations **0039** (`billing_interval`, `subscriptions.cancelled_at`, three platform policies on `idempotency_keys`) and **0042** (`idempotency_keys.platform_scoped` + the tenant policy narrowed, so the console's stored REPLY — our price to a distributor — is not readable through a table the distributor reads by tenant alone). Seed: `dos.admin` (super), a subscription per demo distributor (Tarsun `pro`/active, the other two `standard`/trial), one live and one lapsed support window. `frontend/admin-app` is a placeholder package + generated README.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ **GATE GREEN 2026-09-06 05:15**; turbo 52/52, **2350 tests** twice (core 475, db 100, admin-service 23), `docs:readme:check` + `format:check` clean both workspaces, frontend lint/typecheck/build green, `db:migrate` no-op at 43 migrations, `db:generate` no changes, **`pnpm smoke` 1584 · 0 BROKEN and `--destructive` 1584 · 0 BROKEN three consecutive runs**, `db:seed` twice identical across 139 tables, support path walked by hand end to end (ask → console 403 on its own approval → owner approves → 5-min pass → reads on :3001, 403 on a write, 403 on :3007, one `support.read` audit row per call). Gate fixed five defects with tests: the destructive smoke left the pilot tenant SUSPENDED behind a replayed 200 (toggle keys now run-scoped + the harness signs in again at the end); `db:seed` could not restore a suspended tenant / disabled identity / disabled membership (`restoreDemoAccess`); `modules/ai`'s `ownShopId` read `retailer_links` across tenants for a shopkeeper who buys from more than one distributor; the metrics spec raced a cross-tenant COUNT; and `sync.manifest` was a contract procedure with no handler (built, registry-derived).                                                                                                                                                                                                                                                                                              | ⏳ after backend                                                                                                                                  |
| 14 delta sync coverage + all-in-one runtime (founder 2026-09-05, docs/22 §8 · docs/26 §7). **Sync:** all 37 pull-able tables now have a `registerPull` in their owning module — catalog (4 global), billing (4), receivables (2), delivery (5), warehouse (5), inventory (3), retailers (+pjp, retailer_links), pricing (+bargain_requests) — scoped per role from `SYNC_PULL_TABLES`; tombstones read back from `sync_tombstones` MINUS the ids the caller can still see; the LWW veto (`vetoIfStale`) runs for every op of every table in `SyncService.upload`; `manifest` + `pull` opened to ANY_MEMBER and `sync` mounted read-only on retailer-service (a shop holds 18 tables, no write queue); microsecond cursor that ADVANCES mid-page (a millisecond-truncated one re-read its own boundary rows for ever) with tie completion so a group sharing one `updated_at` is never cut. **All-in-one:** `runAll()` mounts all eight services on one process behind `/auth /owner /manager /sales /warehouse /delivery /retailer /admin` (:3100, `backend/all-in-one`), worker in-process on `DOS_MODE=all WORKER_INLINE=1`; **377 MB RSS from `dist/`** (420 MB under the dev transpiler), budget 400. The eight `ServiceDefinition`s moved to `libs/core/src/service/definitions.ts` and each `<name>-service/src/service.ts` re-exports one, so the two deployment shapes cannot drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | core 495 tests (35 files) · every service spec green · `pnpm smoke` 1588 calls · 0 BROKEN on the eight ports AND `--base http://127.0.0.1:3100` 1588 · 0 BROKEN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                                 |
| sync-runtime (independent gate of module 14, 2026-09-06). Verified the delta-sync coverage + all-in-one slice against the founder's own database and fixed **three real defects, each with a test that fails without the fix**. (1) **A shopkeeper's `sync.pull` read every other customer's `retailer_links` and every tier's rate card** — never-list 9 ("a retailer sees only the rows linked to their own shop"): `retailer_links_read` is `tenant_id = … OR user_id = …` (the OR is the switch-distributor screen) and `price_lists` / `price_list_items` are `tenantReadPolicy`, while `pricing.priceLists.list` is STAFF — so opening the READ half to the shop walked straight past the only gate there was. On the founder's data the shop pulled 31 links (12 of OTHER shops, with their logins) and all 7 price lists; it now pulls 21 links, all its own, and 3 lists — the default plus its own tier, exactly what `QuoteService` resolves. The rep, crew, godown and desk read sets are byte-identical (same `schemaVersion`). (2) **The shop's manifest advertised `sales_orders`, `sales_order_lines` and `receipts` as `writable`** while `sync.upload` is STAFF, so the app would have built a queue whose every flush is a 403 — the 4xx that wedges a device queue for good (docs/07 §7.3 rule 5), and on `receipts` an offer to a shopkeeper to record a payment (docs/17 §D4). `writable` now answers "may THIS role send this table back", read from `PERMISSIONS`. (3) **Every paise column arrived as a JSON string while its own manifest said `integer`** (bigint over node-postgres): a device's offline total would concatenate and `'9300' > '10000'` is true. The pull now narrows exactly the columns the manifest published as numeric, guarded by `Number.isSafeInteger`. Also fixed: `examples.spec.ts` ran `DocExamplesService.load()` six times (six pools, ~600 round trips) and timed out twice under the full parallel build — one shared context now, and the file's DB time fell from 2.16 s to 0.69 s. docs/07 §0 corrected (it said the cursor does **not** advance mid-page, contradicting its own client contract) and given the three shop rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `turbo run build typecheck lint test --force` **56/56 tasks, 2378 tests**, and `turbo run test --force` **2378 again** — core 498 (3 new sync cases), db 100, contracts 78, domain 86, worker 3, all-in-one 1, every service spec. `docs:readme:check` + `format:check` clean in both workspaces; frontend lint/typecheck/build green; `db:migrate` a no-op at **43 migrations**. **`pnpm smoke` 1588 · 0 BROKEN, `--destructive` 1588 · 0 BROKEN, `db:seed`, `pnpm smoke` 1588 · 0 BROKEN**; `db:seed` twice with **identical counts across all 139 tables**; every service `/health` + `/docs/openapi.json` (4 `/sync/` paths on the six role services, none on auth or admin, `x-roles` exactly the matrix). Proved by hand with real tokens: shop 18 tables / **0 writable**, rep 21, crew 19, godown 13, desk 37.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                 |
| ai + platform-admin + demo (full backend) — independent gate, 2026-09-06. Verified the three-distributor demo slice (AI drafts, forecasts, route plans and the platform console for **all three** distributors, not only the pilot) against the founder's own database, and fixed **one real defect the slice had found and only half-fixed**. `modules/ai` composed a SKU's display name as `brand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ' '                                                                                                                                               |               | product |     | ' ' |     | variant`, in THREE queries (`ai.mappers.variantLabels`, and both label queries in `matcher.ts`). The curated catalog deliberately repeats itself — brand `Campa`, product `Campa Cola`, variant `Campa Cola 1 L`; brand `Balaji`, product `Balaji Ratlami Sev`, variant `Balaji Ratlami Sev 200 g`— so **every one of the pilot's 29 listed SKUs** reached the godown's reorder list and the draft review screen as "Campa Campa Cola Campa Cola 1 L", and the same repetition went into the candidate list handed to the language model. The sibling slice had written`composeLabel()`in`seed-demo/ai.ts`for exactly this reason and fixed only the seed, so a seeded draft stored one name and the API rendered another for the same variant. One shared`variantLabelSql`in`modules/ai/ai.internals.ts`now prepends each part only when the name does not already begin with it, and is used by all three queries; the seed's`composeLabel()` is documented as its twin (`@dos/db`sits below`@dos/core`and may not import it). pg_trgm collapses duplicate trigrams, so **no match ever moved** — it was the reading of the guess that was wrong. Verified by hand: the reorder list now reads`Campa Cola 1 L`/`Balaji Ratlami Sev 200 g` on the live services, and a brand the product name does NOT carry (`MOM Makhana`before`MOM Roasted Makhana Peri Peri 60 g`) is still kept. | **No migration, no contract change** — a query expression and two tests. `turbo run build typecheck lint test --force` **56/56 tasks, 2381 tests** and `turbo run test --force` **2381 again** (core 500 — the two new label cases, db 101, contracts 78, domain 86, worker 3, all-in-one 1, every service spec); both new tests fail on the old expression (`'Campa Campa Cola 1 L'` vs `'Campa Cola 1 L'`). `docs:readme:check` and `format:check` clean in both workspaces; frontend `lint`/`typecheck`/`build` 12/12; `pnpm db:migrate` a no-op at **43 migrations**. **`pnpm smoke` 1588 · 0 BROKEN → `--destructive` 1588 · 0 BROKEN → `db:seed` → `pnpm smoke` 1588 · 0 BROKEN**, on all eight services with admin :3007 up; `pnpm db:seed` twice with **identical row counts across all 139 tables**; every service `/health` up and `/docs/openapi.json` carrying **10 `/ai/` paths on each of the six role services, none on auth or admin, and the 12 `/admin/` paths on :3007 alone**. Demo data checked per distributor with real tokens: drafts in all six statuses for Sai and Kalyan too, the confirmed draft's lines equal to its own order's lines variant for variant (Kalyan SO-0069, six lines), **20 of 29 / 13 of 26 / 13 of 24 SKUs below cover**, a rep 403 on the forecast list, and not one money-shaped field on a reorder row. | —   |
| frontend slice 1 `universal` — independent gate, 2026-09-06. Verified `@dos/ui` (both renderers), `@dos/api-client` and `frontend/libs/app-template` from the outside and fixed **nine real defects**: a lost signal wiped the session for good; every 4xx printed the machine word instead of the service's sentence; `/sign-in` with a live session hung forever on the skeleton (`<Redirect>` returned instead of `<Slot/>`); the self-hosted typeface was declared but not shipped, logging an OTS parse error on every page and naming an unresolvable family on native; the desk account menu sat mid-header; the 56 px collapsed rail of UX-00 §8.1 was dead code; the touch floor and the density were fixed per APP while the shell is per VIEWPORT (63 dp buttons on a laptop, 14 px body and a real table on a 375 px phone); `<Screen>` added the iPhone notch a second time inside the shell; and iOS capitalised `sunil.tarsun` into a failed sign-in. Device permissions wired from the linked `PERMISSIONS` matrix. Walked at 1400/1120/1024/375 px in a browser and on the iOS simulator (Expo Go, iPhone 16 Pro)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 14/14 tasks · @dos/ui 98 tests · @dos/api-client 48 · `expo export --platform web` ✓ · web + native `tsc --noEmit` ✓ · format/readme checks clean · 0 non-2xx                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ GREEN — template proven on web + iOS; owner app is next                                                                                        |
| frontend slice 1 `universal` — SECOND independent gate, 2026-09-06 13:45. Re-verified the kit, `@dos/api-client` and the template from the outside and fixed **seven real defects**: after a failed read, `cache.clear()`/`invalidate()` could not restart a query, so switching distributor showed an empty screen and sent no request (and an in-flight answer from the OLD distributor could still land — `QueryEntry.generation` fixes both); the desk rail's tenant switcher was 185 px wide inside a 172 px rail and painted its caret on the page (`<TenantLogo>` clamps to one line on web as it always did on native); every menu row was Apple's 44 pt instead of the app's floor; `<Sheet>` closed with a 32 px desk button on a phone; `<Register>` silently dropped `totals` and `onClearFilters` on native; the kit's own gallery logged four `OTS parsing error` lines and rendered in the wrong typeface; and **X2 forced password change (docs/23 §0) did not exist** in any app. Also: `pnpm format` was rewriting the generated `android/` tree, and `app.json` carried a deprecated `edgeToEdgeEnabled`. Walked at 1400 × 900 and 375 × 812 in a browser, on the **iPhone 16 Pro simulator** and on the **Pixel 7 / API 36 Android emulator** from one codebase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 17/17 tasks · @dos/ui 111 tests · @dos/api-client 52 · `expo export --platform web` ✓ · web + native `tsc --noEmit` ✓ · `format:check` clean · lockfile unchanged · 0 non-2xx outside the role-boundary probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ GREEN — web + iOS + Android from one codebase; dev builds blocked by the ENVIRONMENT only (no iOS 18.2 runtime; JDK 25 vs AGP), recorded above |
| frontend slice 2 `owner-app` (docs/23 §1) — all **26 owner screens** plus the four frame screens on the universal kit, walked screen by screen AND tab by tab at 1400 × 900 and 375 × 812 against the founder's own database, on the web, on the **iPhone 16 Pro simulator** and on the **Pixel 7 / API 36 emulator**. First pass fixed eight defects (one idempotency key per hook → `409 Conflict` on a second save; a signed-out deep link fired five unauthenticated reads; X2 forced password change missing; twenty registers printed enum values; Catalog listed 300 items the distributor does not sell; `<BarLadder>` clipped both columns; the phone shell clipped the fourth tab and the second header action; two figures under the wrong label). **The independent gate then found and fixed nine more**: a service that accepted the connection and never answered left every screen on a skeleton for ever under a strip reading "Updated just now" (20 s request deadline + `<ConnectionStrip>` now says "Not updated yet"); the header search promised shops, bills and orders and read only shops (SO-0220 → "Nothing matches"); the Growth screen drew ratios on a rupee axis, so **stock turns was a flat line at exactly ₹0.00 for twelve months**; the schemes register printed **bps and paise as bare integers** ("2% off on bills over ₹5,000" read `value ≥ 500000 inr` / `order_pct 200`); seven more registers on second-level tabs still printed the database's own words; `<Link variant="text">` was a **21 dp tap target** on a 63 dp phone and the native half had the condition inverted; a Language column was headed "State code"; "Needs you (0)" stated a count over a panel reporting a failure; and `<Register>` read "1 filters"; and three the PHONES found that the browser cannot show — the whole level-2 tab row rendered as an **empty 63 dp band** on native (`<Tabs>` had no width in the header's wrapping row, the fix the web half already carried), the 7/30/90-day segmented control rendered as an **empty 2 px pill**, and every launch logged "Can't perform a React state update on a component that hasn't mounted yet" from the root layout's redirect racing expo-router's navigator (fixed here AND in the template) | 17/17 tasks · @dos/ui **140** tests · @dos/api-client **63** · `expo export --platform web` ✓ · web + native `tsc --noEmit` ✓ · `format:check` and `docs:readme:check` clean in both workspaces · a machine-word crawler over **every route and every second-level tab** reports clean · service suspended → "No connection" on every panel and "Offline since 3:30 pm" on the strip · manager in the owner app answered with the service's own sentence · **`expo run:android` BUILD SUCCESSFUL** on JDK 17 and the app driven on `Pixel_7_API_36` from a fresh install with an empty console · iOS walked in Expo Go on the iPhone 16 Pro simulator | ✅ GREEN — the owner app runs on :5173, and on iOS and Android; manager app is next |
| frontend slice 3 `manager-app` (docs/23 §2) — the ONE app for the manager AND the accountant: all **21 screens of §2.1** plus the AI-drafts tab and the four frame screens, walked screen by screen AND chip by chip at 1400 × 900 and 375 × 812 against the founder's own database, on the web, on the **iPhone 16 Pro simulator** (Expo Go) and on the **Pixel 7 / API 36 emulator** (`expo run:android`, BUILD SUCCESSFUL in 2m 21s). The independent gate fixed **seventeen real defects**, four of which hid a whole feature and all four with one cause — `<Segments>` is 2–3 options and the kit slices to three SILENTLY: M4's **Purchase orders** register was built, fetched on every load and unreachable; a gate-count finding could not be **written off**; only 3 of the 7 **credit-note reasons** could be chosen on a legal document; and a beat broadcast could reach 3 of the pilot's 11 beats with 3 of its 8 WhatsApp templates. Five more where the screen said something untrue: the billing desk printed "211+ left to bill" and "200+ left to bill" sixty pixels apart; every register footer printed a partial sum of a capped page as the column total; `<ConnectionStrip>` said "Offline" whenever the server ANSWERED with a refusal; expired stock wore the same grey chip as stock good until 2027; and "what is due to be claimed" listed a period already settled. Eight smaller (raw user agents as device names, fifty identical "Not numbered yet" gate rows, ISO dates on a chart, dead keyboard promises for the accountant, a doubled filter summary, "Docint" and "Report gst sales register csv" as user-facing words, a bare "—" caption, a meaningless total of per-piece rates). Four in the shared kit with tests: `sync-fonts` resolved one directory too high (fixed in the **template** too, so the remaining five apps are born correct), 12 px chart ticks against a 14 px floor, `<CompareBars>` labels overprinting each other, and the phone "More" sheet growing past the notch with Sign out unreachable. Role boundary proved BOTH ways: the accountant has "Write off the balance" and the manager does not; the manager can confirm an order and the accountant cannot. | 20/20 turbo tasks · @dos/ui **155 tests** · @dos/api-client 63 · `expo export --platform web` ✓ · web AND native `tsc --noEmit` ✓ · `format:check` clean both workspaces · `docs:readme:check` clean · lockfile unchanged by install · 23 desk screens + 8 phone screens + every second-level view with **zero console errors and zero non-2xx** other than the deliberate role-boundary 403s | ✅ **GATE GREEN 2026-09-06 20:30** — web + Android dev build + iOS (Expo Go); `expo run:ios` still blocked by the iOS 18.2 SDK / 18.0 runtime mismatch (environment, not code) |
| six apps (layout A Ledger, design system being finalised)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ⏳ after backend                                                                                                                                  |

## Known gaps to fix in the next schema regeneration (0002 is still local-only)

- `sales_orders_retailer_update` RLS allows retailer updates only when `state = 'draft'`, but the orders service lets a retailer cancel a `submitted` order → widen the USING clause to `state IN ('draft','submitted')`.
- `order_state_transitions` has staff-only writes; the orders service temporarily sets `app.actor_role = 'system'` for a retailer's own cancel → add a retailer-write policy and delete that branch (`orders.internals.ts`).

## Next steps (in order)

1. Finish inventory + procurement (agent), wire, verify, update this log.
2. Migration 0004: review deltas from docs/17 §A + `app_worker` BYPASSRLS role; regenerate types; re-run all specs.
3. `pnpm install` to refresh the lockfile (console now depends on `@dos/contracts`); full workspace green; `/init` refresh of CLAUDE.md.
4. Permanent local Postgres 17 as a Homebrew service on 5439 (data outside the session scratchpad); `.env` at repo root; demo seed with dummy data (brands/products from the real invoices, 3 beats, ~30 retailers, price lists, schemes, stock, a week of orders/invoices/receipts, 2 vehicles, trips).
5. Console pages: pricing (price lists, schemes, bargains queue).
6. Orders module + console approvals; then warehouse/billing, receivables, delivery; then the team app (Expo) screens per role, then the retailer app.

## Session history

- 2026-09-04 (session 1–2): research + synthesis + skeleton; schema (121 tables incl. docs/17 deltas, RLS, ledgers); catalog, retailers, pricing, inventory, procurement, orders, sync modules (API 53 tests, DB 5, domain 50); console with dashboard/catalog/costs/retailers/pricing/orders; review corrections adopted (docs/17); permanent Postgres 17 service on 5439; Flow Atlas artifact + PDF; demo seed in flight at session end.
