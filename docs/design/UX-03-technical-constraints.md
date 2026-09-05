# UX-03 — Technical constraints of six universal apps

**Status:** proposed for founder review, 2026-09-04. Supersedes the frontend rows of `docs/08-frontend-architecture.md` where they disagree (that table was written for two binaries + one Vite console; the product is **six apps, one per role, manager + accountant sharing one**, per `docs/22-source-of-truth.md` §2).
**Scope:** how the six apps are built — not what they look like (UX-01/02) and not what they do (`docs/02`, `docs/06`, `docs/plans/*`).
**Audience:** the founder, and every future session that writes a screen.

Every decision below is stated as **Recommendation → Alternatives rejected → Evidence → Risk if we are wrong → Tripwire**. A tripwire is the observable that means "reopen this decision"; it exists so we can be decisive now without being stuck later.

---

## 0. What is fixed before any decision

| Fixed thing       | Value                                                                                                              | Source                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Apps              | 6: owner (:3001), manager+accountant (:3002), sales (:3003), warehouse (:3004), delivery (:3005), retailer (:3006) | founder, build-log RESUME       |
| Targets           | web + Android + iOS, all three, per app                                                                            | founder 2026-09-04              |
| Language          | English only. Strings isolated in one module per app, no i18n runtime                                              | founder 2026-09-04              |
| Data              | Online-first now. PowerSync offline added to sales + delivery as its own module before the pilot                   | founder 2026-09-04              |
| Performance floor | Budget Android: 4 GB RAM, ~720p, 4G-only, patchy signal                                                            | founder 2026-09-04              |
| Backend contract  | oRPC + Zod 4, one service per app, `MutationBase` (`idempotencyKey` + client UUIDv7 `id`) on every mutation        | `CLAUDE.md`, `shared/contracts` |
| Team              | One person, forever (for planning purposes)                                                                        | —                               |

**Reference device (buy one, test on it, quote its numbers in every perf claim).** The Indian entry-level 2026 band is 4 GB / 64 GB starting around ₹7,999, and 4G-only is still normal below ₹8,000 ([91mobiles](https://www.91mobiles.com/list-of-phones/4gb-ram-mobiles-under-10000), [Smartprix](https://www.smartprix.com/mobiles/price-below_10000)). Pick one ~₹9,000 4 GB device (POCO C-series / Galaxy M04 class) and make it the only device whose numbers count. Every budget in §5 is "on the reference device, on throttled 4G". A budget measured on the founder's Mac or an iPhone is not a budget.

**The single most expensive failure mode for this project is not a slow screen. It is a solo founder spending a week unbreaking a toolchain across six apps.** Several decisions below trade a little ergonomics for a lot of blast-radius reduction, and say so explicitly.

---

## 1. D1 — The big one: universal Expo everywhere, or web-first React for owner + manager?

### Recommendation

**One Expo Router codebase per app. Six apps, all three targets, no second framework. Each app declares a _primary target_, and the two desk apps fork their dense surfaces to real DOM through Metro's platform extensions (`Register.web.tsx` / `Register.native.tsx`).**

| App                  | Primary target                   | Secondary                                  | Shape                                        |
| -------------------- | -------------------------------- | ------------------------------------------ | -------------------------------------------- |
| owner                | **web (desk)**                   | phone (approvals, tiles, map)              | RN shell, DOM-forked dense leaves            |
| manager + accountant | **web (desk)**                   | phone (approvals)                          | RN shell, DOM-forked dense leaves            |
| sales                | **phone**                        | web (rare, a manager covering a beat)      | pure RN                                      |
| warehouse            | **phone/tablet**                 | web (billing desk overlap)                 | pure RN                                      |
| delivery             | **phone**                        | — (web build exists but is never promoted) | pure RN                                      |
| retailer             | **phone web first**, then native | —                                          | pure RN, web output is the shipping artefact |

"DOM-forked leaf" means: on web, the component returns `<table>`, `<input>`, `<button>` — real HTML with real browser behaviour (text selection, `Ctrl`/`Shift` multi-select, right-click, `Tab` order, `Cmd+P`, sticky `thead`, column resize). On native, the same component name returns a `FlashList` of cards. The route tree, the data layer, the tokens, the money formatting and the auth session are shared; only the leaf's rendering differs. React DOM elements render fine inside a react-native-web tree — RNW _is_ React DOM underneath — the only rule is never to nest a DOM element inside `<Text>`.

### Alternatives rejected

1. **Pure react-native-web for everything, including the registers and the billing desk.** Rejected: RN's flexbox subset has no table, no `position: fixed`, no `:hover` primitive, no column-resize idiom; you end up hand-building a grid out of nested `View`s and reimplementing keyboard focus, and you lose native text selection and print. This is the failure mode where "write once" quietly becomes "write a worse browser".
2. **A separate Vite + TanStack Router web app for owner and manager, plus four Expo apps.** This is the honest reading of the current repo (`frontend/owner-app` is exactly this). Rejected on solo-founder economics: it makes 8 artefacts, two routers, two styling systems, two build/test/deploy pipelines, and forces the owner's _phone_ approvals (which docs/06 says is where owners actually approve) into either a third app or a bad mobile-web page. The data layer would be shared, so the saving is real but small; the recurring cost is not.
3. **React Strict DOM.** It is where Meta and Nicolas Gallagher have moved ([RN Rewind](https://thereactnativerewind.com/issues-blog-post/react-native-web-enters-maintenance-mode-a-drop-in-photo-gallery-and-the-strictest-button-youve-ever-met), [Software Mansion 2026 predictions](https://swmansion.com/blog/react-native-in-2026-trends-our-predictions-463a837420c7/)) and it is the strategically correct long-term bet, but it is not an Expo-supported path today and betting a pilot on it is not a solo-founder move. Revisit in 2027.

### Evidence

- **react-native-web is in maintenance mode, and that is survivable.** Latest is **0.21.2**; Nicolas Gallagher's own words in [discussion #2816](https://github.com/necolas/react-native-web/discussions/2816): _"I will continue to review PRs and merge fixes. But I don't expect to put significant time into major development initiatives"_, and (Dec 2025) he is open to adding maintainers from Expo/Shopify. The subset we depend on — `View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `StyleSheet` — has been stable for years and powers the X website ([Expo docs](https://docs.expo.dev/workflow/web/)). Maintenance mode is a real risk for _novel_ web features; we consume none. **We must not build the dense desk UI on RNW, because that is exactly the part where RNW is thin and no longer being invested in.** D1 avoids that part entirely.
- **RNW is measurably heavier and thinner than React DOM for desk work.** An RNW bundle adds roughly 30–40 KB gzipped over the React DOM equivalent, hover has to be re-created through `Pressable` state, and "many CSS properties that browsers take for granted simply don't exist in React Native's flexbox subset" — the same write-up recommends: _"If your primary product is the website… use Next.js for the site and a separate React Native app"_ ([React Native Relay, 2026](https://reactnativerelay.com/article/react-native-web-expo-cross-platform-2026)). Our desk apps are not "primary product is a website" — they are one of two surfaces of a role — so the middle path (fork the leaves) is the right read of that advice, not the extreme.
- **Expo is investing in web, not retreating.** Expo Router v56 forked the React Navigation internals it depends on and shipped streaming SSR ([Expo blog](https://expo.dev/blog/expo-router-v56-decoupling-from-react-navigation)); `web.output: 'static'` pre-renders every route and is the production default ([Expo docs](https://docs.expo.dev/router/web/static-rendering/)). The web target is a first-class Expo artefact for the next several years even if RNW itself is quiet.
- **The desk work is genuinely table-shaped.** From `docs/plans/reporting.md` alone: daily sales, rep productivity, scheme spend, stock value, fill rate, delivery performance, collections, GSTR-1 sales register, GSTR-2 purchase register — every one a paged grid with totals and a CSV export. `docs/plans/billing.md` adds the billing desk. That is ~15 screens where a real `<table>` is worth days.
- **The runtime is current and boring.** Expo SDK **57** (latest `57.0.19` on 2026-09-04) ships **React Native 0.86** with **React 19.2**, reanimated 4.5, worklets 0.10, gesture-handler 2.32, and is explicitly a no-breaking-changes upgrade ([changelog](https://expo.dev/changelog/sdk-57)). SDK cadence is ~3/year (55: Feb 25, 56: May 21, 57: Jun 30, 2026) with Expo signalling optional non-breaking RN bumps in between. New Architecture is the only architecture from RN 0.83 / SDK 55 onward. This is a stable base to build six apps on.

### Risk if we are wrong

The DOM forks metastasise. If half of owner-app ends up as `.web.tsx`, we have built two apps that share a logo, and we pay the maintenance of both without the benefit of either.

### Tripwire (make this a CI check, not a vibe)

Count `*.web.tsx` files under `owner-app/` + `manager-app/`. **Budget: 18.** If we exceed it, stop and split the desk surfaces into one Vite app — cheap to do, because by construction the data layer, tokens and money/qty logic already live in shared packages, not in the app. Also: if a _field_ app (sales/warehouse/delivery/retailer) ever needs a `.web.tsx` fork for layout reasons, that is a design smell, not a platform problem.

---

## 2. D2 — Navigation: expo-router

**Recommendation: `expo-router` (SDK 57's version), file-based, typed routes on, `web.output: 'static'`.** Groups by permission: `app/(auth)/`, then role-scoped groups; the root layout mounts only the groups the session's role permits, so a sales bundle never contains a cost screen (the role-leak rule from `docs/01` is a routing guarantee, not a `hidden` prop).

- **Alternatives rejected:** React Navigation directly (loses file-based routing, typed links, static web rendering, and is now the thing expo-router forked _away_ from); TanStack Router (web-only, would force D1's rejected option 2).
- **Evidence:** Typed routes are generated automatically by Expo CLI ([docs](https://docs.expo.dev/router/reference/typed-routes/)); static rendering pre-renders every route for crawlable, fast-first-paint web ([docs](https://docs.expo.dev/router/web/static-rendering/)); v56 decoupled from React Navigation and brought Android toolbar + Native Tabs to iOS parity ([Expo blog](https://expo.dev/blog/expo-router-v56-decoupling-from-react-navigation)).
- **Migration gotcha to write down now:** post-fork, imports move from `@react-navigation/native` to `expo-router/react-navigation`. There is a codemod and a compat layer ([migration doc](https://docs.expo.dev/router/migrate/sdk-55-to-56/)). Any 2025-era snippet you copy will use the old import.
- **Risk:** expo-router's fork diverges from React Navigation and some community navigator (drawer, material tabs) stops working. **Tripwire:** we need a navigator that isn't in expo-router — if that happens, prefer redesigning the navigation over adding a second router.
- **Hard constraint from §6:** async route bundle splitting is **alpha and web-only** ([docs](https://docs.expo.dev/router/web/async-routes/)). Plan for one JS chunk per app on web. This is the main reason §5's web bundle budget is a _forcing function_ rather than a nice-to-have.

---

## 3. D3 — Data: TanStack Query driven directly off the oRPC contract

**Recommendation: `@tanstack/react-query` (5.102.x, already pinned in `frontend/pnpm-workspace.yaml`) + `@orpc/tanstack-query`'s `createTanstackQueryUtils(client)`. Delete hand-written query keys.**

`frontend/owner-app/src/lib/api.ts` currently hand-maintains a `qk` object. `createTanstackQueryUtils` derives typed `queryOptions`/`mutationOptions`/keys for every procedure in the router, so a contract rename becomes a type error instead of a stale cache key ([oRPC docs](https://orpc.unnoq.com/docs/tanstack-query/react), [npm](https://www.npmjs.com/package/@orpc/tanstack-query)).

- **Keep from the existing app, unchanged:** `createAuthedClient` with the shared refresh cycle, in-memory access token, `remember`-scoped refresh token, and the two-base-URL comment. That code is correct and hard-won; port it to `shared-ui/api` verbatim.
- **Add now, because it is 80% of "offline" for 5% of the work:** persist the query cache (MMKV on native, `localStorage` on web) so a reopened app paints yesterday's beat/ageing/dashboard instantly instead of six spinners on a 4G handshake. Wire `onlineManager` to `expo-network`/NetInfo so Query pauses and resumes honestly.
- **Mutations are already safe to retry** because every mutating procedure carries `idempotencyKey` + a client-generated UUIDv7 `id` (`MutationBase`). Generate the key **once per user intent** (one tap), never per attempt — the existing `newIdempotencyKey()` comment says this; make it a lint-visible rule in `shared-ui`.
- **Risk:** oRPC (1.15.0) is a young library and its TanStack integration has already been versioned once (`@orpc/react-query` → `@orpc/tanstack-query`). **Tripwire:** a breaking oRPC release lands mid-build. Mitigation: the integration is a thin adapter — keep it in one file per app so a rewrite is an afternoon.
- **Zustand for UI-only state** (drawer open, current beat filter). Never for server data. Unchanged from `docs/08`.

---

## 4. D4 — Styling: tokens + `StyleSheet`. No styling library.

**Recommendation: a single `shared-ui/tokens.ts` (typed TS object) that emits (a) an RN theme object consumed by `StyleSheet.create` and (b) a generated `tokens.css` of CSS custom properties for the DOM-forked desk leaves. ~150 lines of variant/breakpoint helpers on top. No Unistyles, no NativeWind, no Uniwind, no Tamagui.**

This _confirms_ the existing `docs/08` decision rather than churning it, but the reasoning has been re-checked against 2026 and one thing changes: drop the planned **Tailwind preset** (we are not using Tailwind anywhere) and replace it with the CSS-variables emitter, which is what D1's DOM forks actually need.

### Alternatives considered, seriously

| Option                  | Why it is attractive                                                                                                                                                                                                                            | Why rejected                                                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unistyles 3** (3.3.0) | The closest call. C++/Nitro core, themes compile to CSS variables on web by default, first-class RNW support, breakpoints/variants built in, 28.9% usage in [State of React Native 2025](https://results.stateofreactnative.com/en-US/styling/) | It is a **Babel plugin** in the hot path of six apps. If it lags one SDK bump, styling breaks everywhere at once for the one person who can fix it. Its own value proposition (StyleSheet-shaped API) is also its escape hatch: adopting it later is mechanical, so there is no cost to waiting. |
| **NativeWind**          | Most-used (42.1%), familiar Tailwind syntax                                                                                                                                                                                                     | The same 2025 survey lists "NativeWind-specific issues" as the **second-most-cited styling pain point** (20 mentions). Class strings also do nothing for the DOM forks that Tailwind would ostensibly serve best, because we would then need Tailwind on web _and_ the RN preset in sync.        |
| **Uniwind**             | From the Unistyles team, 2–2.5× faster than NativeWind, Tailwind v4, works on web ([uniwind.dev](https://uniwind.dev/))                                                                                                                         | Born 2025, and its fast path is a **paid Pro tier**. Too young to carry a system of record for a pilot.                                                                                                                                                                                          |
| **Tamagui**             | Most complete universal UI system, own compiler                                                                                                                                                                                                 | Largest API surface and the most compiler churn of the four; not even ranked in the 2025 survey's experience section. Explicitly rejected in `docs/08` for the same reason.                                                                                                                      |

### Evidence

`StyleSheet` sits at **90.3% usage** — it is the substrate every one of these libraries compiles down to, so choosing it is choosing the thing that cannot be deprecated out from under us. The survey's #1 styling pain point is **light/dark theming** (26 mentions), which is exactly what a token module plus `useColorScheme()` solves in about 40 lines.

### What we must hand-build (and it is small)

`theme` context (light/dark), `useBreakpoint()` off `useWindowDimensions()`, a `variants()` helper for tone/size, and `text` presets. Budget: **≤200 lines total.**

### Risk / tripwire

**Risk:** we spend two days rebuilding a library and it is worse. **Tripwire:** if the variant/theme plumbing crosses 200 lines, _or_ if switching dark mode drops frames on the reference device (context re-render), adopt Unistyles 3 — the migration is mechanical because our styles are already `StyleSheet`-shaped.

---

## 5. D5 — Charts: `react-native-svg` on native, Recharts on web. Never Skia.

The founder specifically asked for growth graphs in the owner app, and the owner app is desk-primary. That single fact decides this.

**Recommendation: one API — `<TrendChart>`, `<CompareBars>`, `<StackedMix>`, `<Sparkline>`, `<BarLadder>` in `shared-ui/charts` (the five names of UX-00 §6.14; `docs/23`'s `<AgeingBuckets>` is `<BarLadder>`; there is no donut) — with two implementations behind a platform fork. `.native.tsx`: thin components over `react-native-svg` + `d3-scale` + `d3-shape`. `.web.tsx`: Recharts.** Chart _data shaping_ (bucketing, IST business-date axes, lakh/crore tick labels, paise→rupee) lives in `shared/domain`, shared by both, tested once.

- **Alternatives rejected:**
  - **victory-native (XL)** — the best-looking native charting library in 2026, Skia + Reanimated + Gesture Handler, actively maintained by Nearform. **It has no official web support** ("Victory Native doesn't officially support web targets… consider using the Victory web library instead"). For six apps where every chart must also render on web, that is a dead end, and it drags in three native peer deps ([repo](https://github.com/FormidableLabs/victory-native-xl)).
  - **react-native-skia everywhere** — the web path loads a **2.9 MB gzipped CanvasKit WASM** ([Skia bundle-size docs](https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size/)). On patchy 4G that is disqualifying for a desk dashboard, and it buys us nothing: our charts are 30–90 point series, not shader work.
  - **react-native-gifted-charts** — no native modules and easy, but lower performance and an opinionated API; and it still isn't the web answer.
- **Evidence for Recharts on web:** ~48.9M weekly downloads, the highest of any React chart library, and the cleanest match to React's component model ([LogRocket 2026](https://blog.logrocket.com/best-react-chart-libraries-2026/)). Its SVG rendering only stutters past ~5 updates/sec on >1,000 points — our dashboards refresh on a 15-minute worker rollup (`reporting.dashboard.owner`), so this is far inside its envelope.
- **Evidence for react-native-svg on native:** it is maintained by Software Mansion and ships "a compatibility layer for the web" ([npm](https://www.npmjs.com/package/react-native-svg)) — so the fork is a convenience, not a necessity, and a native chart can be dropped into a web page unchanged if we ever want pixel parity.
- **Risk:** two chart implementations drift visually. **Mitigation:** both read the same tokens (D4) and the same scale/tick functions; a screenshot test on one representative chart per platform. **Tripwire:** if native ever needs gesture-driven zoom over >5,000 points, add victory-native for _that one screen only_, native-only, and leave Recharts alone.

---

## 6. D6 — Lists: FlashList v2 on native, DOM tables + TanStack Virtual on web

**Recommendation: `@shopify/flash-list` v2 for every scrolling list in the four field apps and the phone surfaces of the desk apps. On web, dense data is a real `<table>` driven by headless TanStack Table v8, virtualised with TanStack Virtual when a page exceeds ~200 rows.**

- **Evidence:** FlashList v2 is a ground-up rewrite for the New Architecture, JS-only, needs no size estimates, and holds 60 fps with complex cells; v2.x is **New-Architecture-only** (fine — SDK 57 has no other option) ([Shopify Engineering](https://shopify.engineering/flashlist-v2), [repo](https://github.com/Shopify/flash-list)). Crucially, FlashList's own docs say web _"should work but the team is not actively testing it right now"_ — which is precisely why the web side of D1 uses DOM tables instead.
- **Alternatives:** `FlatList` (fine under ~500 simple rows, and there is no reason to keep two list APIs); LegendList (promising Fabric+Reanimated list with better blank-cell behaviour on mid-range Android, per early benchmarks — but newer and smaller-community than FlashList; not worth the risk across six apps yet).
- **Design implication that matters more than the library:** the reason lists are fast is cheap cells. A shop card that computes ageing buckets, formats five money values and renders a chart per row will drop frames on the reference device no matter which list renders it. **Rule: a list cell does zero derivation. Everything it displays is precomputed by the server** — which is exactly why `docs/plans/reporting.md` pre-aggregates `retailer_behaviour`, `owner_summary`, `daily_rep_stats`. The frontend must not undo that on the client.
- **Risk:** FlashList v2 web regressions bite the retailer app (web-first, uses lists). **Tripwire:** if the retailer web catalog list janks, swap that one list for a plain `ScrollView` + TanStack Virtual — the retailer's catalog is 200–2,000 SKUs, not a million.

---

## 7. D7 — Forms: react-hook-form for records, no form library for transactions

**Recommendation: `react-hook-form` + `@hookform/resolvers/zod` for _record-editing_ forms (product, retailer, scheme, settings, user). For the _transactional editors_ — order editor, pack screen, receipt/collection, GRN review — use purpose-built stateful components with a single Zod parse against the contract schema on submit. No form library there.**

- **Why the split:** the transactional screens are not forms. They are a `QtyStepper` showing "2 case = 180 pcs", a `NumberPad`, a live price quote from `pricing.quote`, an ATP badge, and a running total. Wrapping that in a form library adds `Controller` boilerplate around widgets that already own their state, and buys nothing — the validation that matters is the server's, and it is already expressed as the Zod schema in `shared/contracts`.
- **Why RHF for records:** biggest ecosystem, works in RN, and the resolver lets a form validate against **the exact same Zod schema the server validates against** — one definition, two enforcement points. TanStack Form is more type-strict and its controlled-only model suits RN better in the abstract, but it is more code per form and we have maybe 20 record forms total ([LogRocket comparison](https://blog.logrocket.com/tanstack-form-vs-react-hook-form/), [Formisch comparison](https://formisch.dev/blog/react-form-library-comparison/)).
- **Risk:** RHF's `Controller`-per-field verbosity in RN. **Mitigation:** one `<Field>` wrapper in `shared-ui` hides it. **Tripwire:** if `<Field>` needs per-widget special cases beyond three, switch the record forms to TanStack Form (they are isolated; the transactional screens are unaffected either way).

---

## 8. D8 — Overlays: `@gorhom/bottom-sheet` v5 on native, dialogs/side panels on web

**Recommendation: `<Sheet>` in `shared-ui`. Native → `@gorhom/bottom-sheet` v5 with `BottomSheetFlashList`. Web → a focus-trapped dialog (`<dialog>`) or a right-hand side panel, never a bottom sheet.**

- **Evidence:** gorhom v5 is the feature-complete option — Reanimated-driven on the UI thread, multiple snap points, dynamic sizing, and list components that handle nested scrolling correctly ([repo](https://github.com/gorhom/react-native-bottom-sheet)). `@expo/ui/community/bottom-sheet` delegates to Jetpack Compose / SwiftUI / a web drawer and is a one-line import swap, but Expo's own post says the universal web layer _"is experimental… not at the same quality bar as native yet"_ ([Expo UI stable post](https://expo.dev/blog/expo-ui-stable-sdk-56)).
- **A bottom sheet on a 24" desk monitor is wrong UI**, not a compatibility problem — hence the fork.
- **Risk:** gorhom + Reanimated 4.x + worklets 0.10 is the most animation-coupled dependency we take. SDK 57 already had to fix a Hermes V1 memory regression affecting apps that import `react-native-worklets`/`reanimated` (fixed in `expo@57.0.9`; a dev-startup regression fixed in `57.0.17`) ([changelog](https://expo.dev/changelog/sdk-57)). **Mitigation:** pin exact versions, never float. **Tripwire:** a sheet-related crash that survives an SDK patch → move to `@expo/ui/community/bottom-sheet` on native (one-line swap).

---

## 9. D9 — Expo UI: use it for controls, not for the design system

**Recommendation: adopt `@expo/ui` selectively — the `@expo/ui/community` drop-in replacements (date/time picker, segmented control, picker, slider) where a native control is genuinely better than ours. Do **not** build the design system on Expo UI universal components.**

- **Evidence:** Expo UI's Jetpack Compose and SwiftUI APIs are stable as of SDK 56, universal components (`Host`, `Row`, `Column`, `Text`, `TextInput`, `Button`, `Switch`, `BottomSheet`) exist and are backed by react-dom/RNW on web — but Expo's own post says _"Web is experimental"_ and positions Expo UI as _"primitives iOS and Android already ship, as React components — not a design system or styled component library"_, pointing you back to `View`/`Text` for custom design ([Expo blog](https://expo.dev/blog/expo-ui-stable-sdk-56)).
- **Where it wins concretely:** a native date picker for FY/period selection and a native segmented control for the ageing buckets are better than anything we would draw, on both platforms, for free.
- **Risk:** the founder asked for a _distinctive, current_ visual language. Native platform controls are by definition not distinctive. **Rule:** Expo UI appears only in inputs, never in the surfaces the founder will judge the design on.

---

## 10. D10 — Camera and scanning: VisionCamera in warehouse only, expo-camera everywhere else

This decision carries the pilot's #1 conversion criterion (photo-to-GRN, `docs/01`), so it gets the most specific reasoning.

**Recommendation:**

- **warehouse-app: `react-native-vision-camera` + its ML Kit code-scanner plugin.** Formats restricted to `['qr-code','ean-13','ean-8','code-128']`; photo/frame output at the **highest available resolution**; torch control exposed; a manual "tap to focus" affordance.
- **sales / delivery / retailer / owner: `expo-camera`.** They only take photos (ePOD proof, damage, shelf) — no frame-level work, no second native camera stack in four apps.
- **Web: no scanning.** Every capture surface on web is a file `<input>` that uploads to the same endpoint.

- **Evidence:**
  - The GST **signed QR is a JWT** (header.payload.signature) carrying invoice facts, and _"the signed QR code need not be decoded before printing. If it is decoded, the signature of the IRP attached will be lost, thereby making it unverifiable"_; print size is specified as ≥2in × 2in to be scannable ([GSTN FAQ PDF](https://einvoice1.gst.gov.in/Documents/IRN_QR_FAQS.pdf), [ClearTax](https://docs.cleartax.in/cleartax-docs/e-invoicing-api/learn-e-invoicing-api-basics/how-to-scan-the-e-invoice-qr-code)). That means a **dense, high-version QR** — the hardest case for a phone camera, often printed small and smudged on a dot-matrix invoice.
  - Margelo's 2026 barcode guide: for dense codes, _"scan at the highest available resolution"_ (VisionCamera `resolution: 'full'`), and _"a scanner looking for `['qr-code']` runs measurably faster than one decoding all thirteen formats"_ ([Margelo](https://margelo.com/blog/react-native-barcode-scanner)).
  - expo-camera has `onBarcodeScanned` built in and is fine for clean codes, but gives less control over resolution/format/exposure, and on **web builds Chrome and Firefox recognise QR at best**, other symbologies failing ([Scanbot comparison](https://scanbot.io/blog/react-native-vision-camera-vs-expo-camera/)).
- **Hard implementation rules (write these in the code):**
  1. Send the **raw scanned string** to the backend untouched — no trimming, no normalising, no re-encoding, no JSON round-trip that could reorder anything. The signature verification happens server-side on bytes we did not touch.
  2. The scan screen never blocks. If the QR will not read in 8 seconds, offer "photograph the invoice instead" and fall through to the LLM-vision path — the pipeline in `docs/05` already supports it.
  3. Gate count stays typed. "Zero manual entry except the blind gate count" (`docs/01`) is a product promise; the camera must never be allowed to quietly become the counter.
- **Risk:** two camera libraries in the tree, and VisionCamera requires a development build (no Expo Go). **Accepted:** the warehouse app needs a dev build regardless (Expo Go cannot do what it needs), and only that app depends on VisionCamera, so the other five apps' bundles are unaffected. **Tripwire:** if VisionCamera's decode rate on real Tarsun supplier invoices is below ~85% first-try, evaluate a commercial SDK (Scanbot/Dynamsoft) for that one screen — Margelo notes free decoders can trip on very dense real-world codes.

---

## 11. D11 — Haptics: `expo-haptics`, on commits only

**Recommendation: `expo-haptics` (v57.0.2), used for exactly four things.**

| Event                                                                                        | Feedback                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Commit succeeded (order placed, receipt collected, GRN posted, stop delivered, trip settled) | `notificationAsync(Success)` + a visible success state |
| Commit rejected (credit stop, validation failure, variance outside tolerance)                | `notificationAsync(Error)`                             |
| Discrete value change (qty stepper tick, case/pcs toggle, snapping a slider)                 | `selectionAsync()`                                     |
| Destructive confirm (cancel invoice, void receipt)                                           | `impactAsync(Medium)`                                  |

Nothing else. No haptic on navigation, scroll, or list selection — that is the difference between "feels good" and "feels cheap".

- **Evidence:** expo-haptics supports **Android, iOS and Web** (Web Vibration API, with recent iOS-Safari improvements), and selection/notification feedback exists on all three ([Expo docs](https://docs.expo.dev/versions/latest/sdk/haptics/), [changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo-haptics/CHANGELOG.md)).
- **Rules:** wrap every call (historically expo-haptics did not degrade gracefully on unsupported platforms — [issue #19141](https://github.com/expo/expo/issues/19141)); expose a per-user "vibration" switch in settings; never rely on haptics to convey information a user could miss (state is always colour + icon + word, per `docs/08`'s zero-training rules).
- **Budget-Android note:** cheap linear vibration motors render `Success` and `Error` almost identically. So the haptic is **confirmation of a visible thing**, never the signal itself.

---

## 12. D12 — Local storage: MMKV now, op-sqlite when PowerSync lands

**Recommendation: `react-native-mmkv` for the session, the persisted TanStack Query cache and small UI prefs; `localStorage` on web behind the same tiny interface. When the offline module lands, PowerSync + op-sqlite is added alongside — it does not replace MMKV.**

- Keep the existing `remember`-scoped refresh-token behaviour from `frontend/owner-app/src/lib/session.tsx` exactly as it is; only the storage backend changes per platform.
- **PowerSync note for later (not this phase):** the retailer app must never be a PowerSync client — `docs/02` already priced this (Pro is $30 per 1,000 peak clients, Free tier 50; Tarsun's ~150 retailers alone break Free). PowerSync now also ships a free source-available **Open Edition** for self-hosting ([powersync.com/open-source](https://powersync.com/open-source)), which changes the economics of the _staff_ rollout at scale — worth re-pricing when the offline module is scheduled, not now.

---

## 13. Performance: budgets on the reference device, and how we measure

Budgets are useless without a device and a measurement command. Here are both.

### Budgets (fail CI or fail review)

| Metric                                               | Budget                                           | Where measured                                |
| ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Cold launch (process start → native launch complete) | **≤ 1.5 s**                                      | EAS Observe, reference device                 |
| Warm launch                                          | ≤ 0.5 s                                          | EAS Observe                                   |
| JS bundle load/eval                                  | ≤ 0.3 s                                          | EAS Observe                                   |
| Time to first render (incl. cold launch)             | **≤ 2.0 s**                                      | EAS Observe                                   |
| Time to interactive (incl. cold launch)              | **≤ 3.0 s**                                      | EAS Observe                                   |
| Per-app JS bundle (Hermes bytecode, release)         | ≤ 2.0 MB                                         | Expo Atlas, CI                                |
| **Web initial route, gzipped**                       | **≤ 600 KB** field apps / **≤ 900 KB** desk apps | CI, `expo export -p web`                      |
| Android download size                                | ≤ 30 MB                                          | EAS build output                              |
| List scroll                                          | ≥ 55 fps median, ≤ 1% frozen frames              | EAS Observe TTI frame data + manual on device |
| Screen→screen navigation                             | ≤ 300 ms to first content                        | manual, reference device                      |

The first five numbers are **Expo's own published recommendations** for EAS Observe ([metrics reference](https://docs.expo.dev/eas/observe/reference/metrics/)) — not invented. Adopt them as-is so we are arguing with a vendor's baseline rather than a personal opinion. The 600 KB web figure carries forward the budget `docs/02` already set for the retailer app; the desk apps get 900 KB because they legitimately carry Recharts + TanStack Table, and because **route splitting is not available** (D2 / async routes are alpha).

### How we measure

- **Bundle composition:** `EXPO_UNSTABLE_ATLAS=true npx expo start` → Expo Atlas, which reads Metro's own dependency graph rather than source maps (source-map explorers can leave ~30% of a bundle unattributed) ([Callstack](https://www.callstack.com/blog/knowing-your-apps-bundle-contents-native-performance)). Run it whenever a dependency is added; screenshot the treemap into the build log.
- **Field metrics:** **EAS Observe** (public beta since SDK 57) for cold/warm launch, TTR, TTI, per-route navigation metrics (SDK 56+) and iOS memory warnings (SDK 57+). This is the only way to learn what the pilot's actual phones do.
- **Local:** React Native DevTools (SDK 57 added light/dark emulation), plus `performance.mark` around the three flows that matter: sign-in → beat list; scan → GRN review; open order editor → first quote.

### The three things that will actually be slow, and the rule for each

1. **First paint after sign-in on 4G.** Rule: paint the persisted cache immediately, then revalidate. Never a full-screen spinner on a screen we have data for.
2. **The order editor's price quote.** Rule: `priceOrder()` runs locally from `shared/domain` for the optimistic number; `pricing.quote` confirms. The user never waits on a round trip to see a line total.
3. **Images.** Rule: `expo-image` everywhere, never `Image`; every product/proof image served pre-resized from the API with a width parameter; ePOD photos compressed client-side to ≤ 1600 px / ~200 KB before upload. Uploading a 12 MP photo over rural 4G is the single most likely cause of "the delivery app is stuck".

### Bundle-size mechanism (not just a budget)

Platform-forked files are how we keep web small: `Scanner.native.tsx` means `react-native-vision-camera` never enters the web graph; `Map.native.tsx` keeps `react-native-maps` out; `Chart.web.tsx` keeps `d3-shape` off the native side. **Any native-only dependency must be reachable only from a `.native.tsx` file.** Make this a review checklist item.

---

## 14. Accessibility and platform fit

### 14a. Android 16 is not optional, and it changes layout

**From 31 August 2026, Google Play requires new apps and updates to target Android 16 (API 36).** Apps targeting 36 **cannot opt out of edge-to-edge**, and **predictive back is on by default** ([RN community discussion #921](https://github.com/react-native-community/discussions-and-proposals/discussions/921), [Expo edge-to-edge post](https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android)). SDK 57 shipped further edge-to-edge fixes.

**Consequences, mandatory from screen one:**

- Every screen composes from `react-native-safe-area-context` insets. No hard-coded top/bottom padding, ever. A hard-coded `paddingTop: 24` is a bug that will only show up on someone's phone in Kalyan.
- Sticky bottom action bars (the delivery app's "Delivered / Partial / Failed", the order editor's total bar) must add `insets.bottom` — otherwise the primary action sits under the gesture pill.
- Back handling goes through expo-router/react-native-screens; do not add ad-hoc `BackHandler` interception. A screen that must confirm before leaving uses the router's own guard, so predictive back animates correctly.
- Status/navigation bar contrast must be set per screen theme, since content now paints behind both.

### 14b. Dynamic type and dense numbers

RN scales text with the OS font setting. On a register row with six money columns, a 1.5× multiplier destroys the layout — and disabling scaling (`allowFontScaling={false}`) is an accessibility failure.

**Rule:** `maxFontSizeMultiplier={1.3}` on numeric/tabular text only; labels and body scale freely; **every row must be able to wrap to two lines** without clipping. Test at 130% and 200% system font on the reference device before any screen is called done.

### 14c. Screen readers

- Money must be announced as words, not glyphs: a `speakMoney(paise)` helper in `shared/domain` alongside the existing `<Money>` formatting, used as `accessibilityLabel`. "₹1,24,500.00" read character-by-character is unusable.
- Status is `colour + icon + word` already (`docs/08`); the word is what the screen reader gets, so state never depends on colour alone — which also covers colour-blind users and a phone in direct godown sunlight.
- RNW maps its primitives to sane a11y semantics, and the DOM-forked desk tables get real `<table>`/`<th scope>` semantics for free — a second, quiet argument for D1.
- **Web-specific:** RNW's `Pressable` strips focus outlines. Restore a visible `:focus-visible` ring in `tokens.css`. A desk app that cannot be driven from the keyboard will be rejected by the one accountant who uses it all day.

### 14d. Dark mode

Both themes are real requirements, not vanity: a warehouse in daylight needs maximum-contrast light; a delivery rider at 9 pm wants dark. `useColorScheme()` + the two token sets from D4, with a manual override in settings (the OS setting is often wrong for a work app).

### 14e. Touch and reach

- Minimum touch target 48 dp; on the delivery and warehouse apps, 56 dp for primary actions — these are used one-handed, sometimes with gloves, sometimes in rain.
- Primary actions live in the **bottom third** on phone. Top-right "Save" is a desk pattern.
- Every screen opens on its most likely action (already the rule in `docs/08`); on phone that action must be reachable without a scroll.

### 14f. Connection state, honestly

Online-first now, offline later — but the _design_ must be honest either way, so build it once now:

`useConnection()` returns `{ online, lastSyncedAt, pendingWrites }`. A persistent, **non-blocking** strip renders "Last updated 2 min ago" / "Offline — 3 orders waiting". Never a modal. Never a "Sync now" button (`docs/08`). When PowerSync lands, only the source of `pendingWrites` changes — no screen changes.

---

## 15. What `shared-ui` must abstract

This is the actual deliverable of the frontend phase: the list of things a screen author never decides twice. Everything here is written once and forked by platform _inside_ the package, so a screen is written once.

| #   | Abstraction                                                                                  | Native                      | Web                                |
| --- | -------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| 1   | `<Screen>` — insets, scroll, edge-to-edge, keyboard avoidance, pull-to-refresh               | SafeArea + KeyboardAvoiding | max-width container, no insets     |
| 2   | Navigation chrome                                                                            | native tabs / stack headers | sidebar + breadcrumb               |
| 3   | `<Text>` — the only text component; type ramp + dynamic-type caps                            | RN Text                     | DOM element with the same ramp     |
| 4   | `<Money>` / `<RupeeInput>` / `<QtyStepper>` — paise in, paise out; case + pcs shown together | shared                      | shared                             |
| 5   | `<NumberPad>` — numeric entry is a keypad, never a text field                                | shared                      | keyboard-first on desk             |
| 6   | `<DataSurface>` — the register abstraction                                                   | FlashList of cards          | `<table>` + TanStack Table/Virtual |
| 7   | `<Sheet>`                                                                                    | gorhom bottom sheet         | `<dialog>` / side panel            |
| 8   | `<TrendChart>` etc.                                                                          | react-native-svg + d3       | Recharts                           |
| 9   | `<Scanner>` / `<PhotoCapture>`                                                               | VisionCamera / expo-camera  | file input                         |
| 10  | `<StatusPill>`, `<ConnectionStrip>`, `<EmptyState>`, `<ErrorState>`                          | shared                      | shared                             |
| 11  | `feedback` — haptics + toast + optimistic transitions                                        | expo-haptics                | Web Vibration / visual only        |
| 12  | `tokens` — colour (light/dark), type ramp, spacing, radius, elevation, motion                | TS object                   | generated CSS variables            |
| 13  | `api` — oRPC client, auth refresh, query utils, idempotency-key discipline                   | shared                      | shared                             |
| 14  | `strings` — one module per app, English only, no i18n runtime                                | shared                      | shared                             |

**The rule that makes this work:** a screen file may import from `shared-ui`, `shared/domain` and `shared/contracts`. It may not import `react-native` primitives directly except `View`. If a screen needs something RN gives it directly, that is a missing `shared-ui` component. Enforce with an ESLint `no-restricted-imports` rule — the same instinct as the backend's `eslint-plugin-boundaries`.

---

## 16. Sequencing (what a solo founder should actually build first)

Six apps × three targets is 18 artefacts. They do not all ship at once.

1. **`shared-ui` + tokens + `<Screen>`/`<Text>`/`<Money>`/`<DataSurface>`/`<TrendChart>`** against the mockup direction the founder picks. Nothing else starts until these exist.
2. **All six apps on web** (`expo export -p web`). Fastest path to the stated goal — "fully working apps on the local database with dummy data" — and the founder can click all six from one browser. Desk apps are _done_ here; field apps are previews.
3. **Native dev builds for warehouse → sales → delivery → retailer.** Warehouse first because photo-to-GRN is conversion criterion #1 and it is the only app with a hard native dependency (VisionCamera).
4. **Native for owner + manager last.** They are desk-primary; their phone surfaces (approvals, tiles, map) are a subset.
5. **Then** the offline module for sales + delivery.

**Development builds are required from day one for warehouse** (VisionCamera, MMKV are not in Expo Go). Expo Go is fine for the other four during design iteration — note that Expo UI is now available in Expo Go as of SDK 56.

---

## 17. Risk register

| #   | Risk                                                                  | Likelihood | Blast radius                                       | Mitigation / tripwire                                                                                                                                                                        |
| --- | --------------------------------------------------------------------- | ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | DOM forks metastasise; we have accidentally built two apps            | Medium     | Owner + manager                                    | CI counts `*.web.tsx` in desk apps; budget 18; over budget → split desk into a Vite app (cheap, data layer is already shared)                                                                |
| R2  | react-native-web stalls further and something we use breaks           | Low        | All web builds                                     | We use only the frozen primitive subset; dense UI is already DOM. Watch for Expo/Shopify taking maintainership                                                                               |
| R3  | No web route splitting (async routes alpha) → desk web bundle bloats  | **High**   | Desk web first paint on 4G                         | Hard gzip budget in CI (900 KB); native-only deps only reachable from `.native.tsx`; lazy-load export/CSV code                                                                               |
| R4  | Dense GST QR fails to scan on real Tarsun invoices                    | Medium     | Conversion criterion #1                            | VisionCamera at full resolution, format-restricted, torch + tap-focus; 8 s fallback to photo pipeline; <85% first-try → evaluate a commercial SDK for that screen only                       |
| R5  | Reanimated/worklets regression on an SDK bump                         | Medium     | Every app's animation + sheets                     | Pin exact versions; SDK 57 already shipped two such fixes; keep gorhom swappable for `@expo/ui` bottom sheet                                                                                 |
| R6  | Android 16 edge-to-edge / predictive back breaks layouts near release | Medium     | Android, all apps                                  | Insets from screen one; test on Android 16 from the first build, not before submission                                                                                                       |
| R7  | Two chart implementations drift                                       | Medium     | Owner credibility (the founder's headline feature) | Shared scales/ticks/formatters in `shared/domain`; one screenshot test per platform                                                                                                          |
| R8  | Six apps × 3 platforms exceeds one person's upgrade capacity          | **High**   | Everything                                         | One SDK version across all six, upgraded together, once per SDK; `shared-ui` absorbs every breaking change so app code rarely moves; keep the dependency list as short as this document does |
| R9  | Styling done by hand turns into a bad library                         | Low        | Design velocity                                    | 200-line budget; over it → adopt Unistyles 3 (mechanical, styles are already StyleSheet-shaped)                                                                                              |

---

## 18. Changes this document makes to `docs/08-frontend-architecture.md`

`docs/08` was written for **two Expo binaries + one Vite console**. The product is now **six universal apps, one per role, with the manager and the accountant sharing one** (`docs/22-source-of-truth.md` §2; `docs/02-five-apps-and-surfaces.md`'s "two store binaries" verdict is superseded too). Amend `docs/08` as follows (or mark it superseded by this file for the frontend stack):

- **Team app / Console rows** → replaced by the six-app matrix in §1.
- **Styling row** → keep "no Tamagui, no NativeWind", keep tokens + `StyleSheet`; **replace the Tailwind preset with a generated CSS-variables emitter**; add Unistyles 3 as the named fallback with its tripwire.
- **i18n row** → **struck for now.** English only, no `i18next`, no Devanagari font, strings isolated per app (founder, 2026-09-04).
- **Local data row** → PowerSync/op-sqlite deferred; TanStack Query with a persisted cache is the current answer for all six.
- **Retailer app row** → still online-first, still never a PowerSync client, still web output first. Unchanged and still correct.
- **New rows needed:** charts (D5), lists (D6), scanning (D10), haptics (D11), performance budgets (§13), Android 16 constraints (§14a).

---

## 19. Sources

Runtime and framework

- [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) — RN 0.86, React 19.2, reanimated 4.5 / worklets 0.10 / gesture-handler 2.32, Hermes memory fix in 57.0.9, dev-startup fix in 57.0.17
- [expo on npm — versions](https://www.npmjs.com/package/expo?activeTab=versions) — 57.0.19 current on 2026-09-04
- [Expo Router v56: decoupling from React Navigation](https://expo.dev/blog/expo-router-v56-decoupling-from-react-navigation)
- [Expo Router SDK 55→56 migration](https://docs.expo.dev/router/migrate/sdk-55-to-56/) — import codemod
- [Expo Router: static rendering](https://docs.expo.dev/router/web/static-rendering/) · [async routes (alpha, web-only)](https://docs.expo.dev/router/web/async-routes/) · [typed routes](https://docs.expo.dev/router/reference/typed-routes/)
- [Expo: web support](https://docs.expo.dev/workflow/web/) · [Expo UI is stable (SDK 56)](https://expo.dev/blog/expo-ui-stable-sdk-56)

react-native-web status

- [necolas/react-native-web discussion #2816 — future & maintainers](https://github.com/necolas/react-native-web/discussions/2816)
- [react-native-web releases](https://github.com/necolas/react-native-web/releases) — 0.21.2
- [The React Native Rewind — RNW enters maintenance mode](https://thereactnativerewind.com/issues-blog-post/react-native-web-enters-maintenance-mode-a-drop-in-photo-gallery-and-the-strictest-button-youve-ever-met) _(secondary)_
- [Software Mansion — React Native in 2026](https://swmansion.com/blog/react-native-in-2026-trends-our-predictions-463a837420c7/) _(secondary)_
- [React Native Relay — RNW + Expo guide 2026](https://reactnativerelay.com/article/react-native-web-expo-cross-platform-2026) _(secondary; bundle delta, flexbox subset, hover)_

Libraries

- [State of React Native 2025 — styling](https://results.stateofreactnative.com/en-US/styling/)
- [react-native-unistyles](https://github.com/jpudysz/react-native-unistyles) · [Uniwind](https://uniwind.dev/)
- [FlashList (Shopify)](https://github.com/Shopify/flash-list) · [FlashList v2 rewrite](https://shopify.engineering/flashlist-v2)
- [victory-native-xl](https://github.com/FormidableLabs/victory-native-xl) · [react-native-skia bundle size (2.9 MB gz CanvasKit)](https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size/)
- [LogRocket — best React chart libraries 2026](https://blog.logrocket.com/best-react-chart-libraries-2026/) _(Recharts download share, SVG update limits)_
- [react-native-svg](https://www.npmjs.com/package/react-native-svg) — web compatibility layer
- [@gorhom/bottom-sheet](https://github.com/gorhom/react-native-bottom-sheet)
- [@orpc/tanstack-query](https://www.npmjs.com/package/@orpc/tanstack-query) · [oRPC TanStack Query docs](https://orpc.unnoq.com/docs/tanstack-query/react)
- [LogRocket — TanStack Form vs React Hook Form](https://blog.logrocket.com/tanstack-form-vs-react-hook-form/) · [Formisch comparison](https://formisch.dev/blog/react-form-library-comparison/)
- [expo-haptics docs](https://docs.expo.dev/versions/latest/sdk/haptics/) · [changelog (sdk-57)](https://github.com/expo/expo/blob/sdk-57/packages/expo-haptics/CHANGELOG.md) · [issue #19141](https://github.com/expo/expo/issues/19141)
- [PowerSync open source / Open Edition](https://powersync.com/open-source)

Scanning and GST

- [GSTN — FAQs on signed QR code (PDF)](https://einvoice1.gst.gov.in/Documents/IRN_QR_FAQS.pdf)
- [ClearTax — how to scan the e-invoice QR code](https://docs.cleartax.in/cleartax-docs/e-invoicing-api/learn-e-invoicing-api-basics/how-to-scan-the-e-invoice-qr-code)
- [Margelo — scanning barcodes in React Native, the complete guide (2026)](https://margelo.com/blog/react-native-barcode-scanner)
- [Scanbot — VisionCamera vs expo-camera](https://scanbot.io/blog/react-native-vision-camera-vs-expo-camera/) _(vendor, but specific on web decode limits)_

Performance and platform

- [EAS Observe — metrics reference](https://docs.expo.dev/eas/observe/reference/metrics/) — the launch/TTR/TTI budgets adopted in §13
- [Callstack — bundle contents and Expo Atlas](https://www.callstack.com/blog/knowing-your-apps-bundle-contents-native-performance)
- [Expo — understanding app size](https://docs.expo.dev/distribution/app-size/)
- [RN community discussion #921 — Android 16 changes impacting React Native](https://github.com/react-native-community/discussions-and-proposals/discussions/921)
- [Expo — edge-to-edge display streamlined for Android](https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android)
- [91mobiles — 4 GB RAM phones under ₹10,000 (Sep 2026)](https://www.91mobiles.com/list-of-phones/4gb-ram-mobiles-under-10000) · [Smartprix — under ₹10,000](https://www.smartprix.com/mobiles/price-below_10000)

Repo files this document depends on

- `docs/01-positioning-and-standout-features.md`, `docs/02-five-apps-and-surfaces.md`, `docs/06-order-to-cash-flows.md`, `docs/08-frontend-architecture.md`, `docs/18-build-log.md`, `docs/plans/reporting.md`, `docs/plans/billing.md`
- `frontend/owner-app/src/lib/{api.ts,session.tsx,router.tsx}`, `frontend/owner-app/src/styles.css`, `frontend/pnpm-workspace.yaml`
