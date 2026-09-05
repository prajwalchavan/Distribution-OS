<!-- Research note, 2026-09-04. Area: what "current standards" means for a 2026 product like this. Grounded in web research; every claim carries a source. Advisory input to the design system — not a frozen decision doc; decisions still land in docs/15-decisions-log.md. -->

# UX-02 — Current standards (2026): what is current, what is dated, what we adopt

**Audience:** whoever writes the shared UI kit and the six app shells (owner :3001, manager+accountant :3002, sales :3003, warehouse :3004, delivery :3005, retailer :3006).
**Purpose:** make sure that when Tarsun's owner, his manager, his two salesmen, his delivery crews and his retailers open these apps in 2026, the apps read as *a current product*, not as "another DMS". The workflows come from existing distributor software (that research lives in `docs/research/R01`–`R10`); the **visual and interaction language must not**.

Founder constraints treated as fixed here: English only for now (strings isolated, no i18n layer yet); online-first now with offline for sales+delivery before the pilot, and connection state shown honestly either way; Android and iOS equally; performance floor is a budget Android on patchy 4G; "spend good time designing UI as per professional industry standards, have haptics etc, make it feel good."

> Note for the parent session: this brief describes **six** apps and ports 3001–3006, while `docs/02-five-apps-and-surfaces.md` and `CLAUDE.md` still describe five services (3001–3005) with owner+manager+accountant sharing :3001. This document is written against the six-app split given in the brief; the discrepancy needs resolving in `docs/02` / `docs/19` before the UI kit's app shells are generated.

---

## Part 1 — The platform baseline in 2026

### 1.1 Android: Material 3 Expressive

Material 3 Expressive is the current Material, not a variant. The changes that actually matter to us:

- **Motion moved from duration+easing to spring physics.** M3's motion physics system replaces duration/easing pairs as the primary model; springs are defined by stiffness, damping and initial velocity. Tokens split into **spatial** springs (position, size, rotation, corner radius — overshoot allowed) and **effects** springs (colour, opacity — no overshoot), each with `fast` / `default` / `slow`, under two schemes: **standard** (higher damping, minimal bounce) and **expressive** (lower damping, visible overshoot). Token shape: `md.sys.motion.spring.fast.spatial`. ([m3.material.io/styles/motion](https://m3.material.io/styles/motion/), [supercharge.design](https://supercharge.design/blog/material-3-expressive))
- **The old duration/easing tokens still exist and are still the safe cross-platform floor.** Real values from Google's own token JSON: `short1 50ms`, `short2 100ms`, `short3 150ms`, `short4 200ms`, `medium1 250ms`, `medium2 300ms`, `medium3 350ms`, `medium4 400ms`, `long1 450ms` … `extra-long4 1000ms`; easings `standard cubic-bezier(0.2, 0, 0, 1)`, `standard.decelerate (0, 0, 0, 1)`, `standard.accelerate (0.3, 0, 1, 1)`, `emphasized.decelerate (0.05, 0.7, 0.1, 1)`, `emphasized.accelerate (0.3, 0, 0.8, 0.15)`, `legacy (0.4, 0, 0.2, 1)`. ([material-tokens/json/motion.json](https://github.com/material-foundation/material-tokens/blob/json/json/motion.json), [m3 easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs))
- **Shape is now a system**, with ~35 defined shapes and animated morphing between them; type got bolder and more contrast-driven; dynamic colour derives tonal palettes from a seed. Google reports 46 studies with 18,000+ participants and users spotting key UI elements up to ~4× faster in Expressive layouts than in standard M3 — the takeaway for us is not "add squircles", it is **exaggerate the hierarchy of the one thing on screen that matters**. ([Android Authority deep dive](https://www.androidauthority.com/google-material-3-expressive-features-changes-availability-supported-devices-3556392/))

**What we take:** the motion tokens (as durations first, springs where Reanimated makes it cheap), the hierarchy lesson, edge-to-edge layout, Android's haptic constants, and the *tonal* discipline of colour roles.
**What we skip:** dynamic colour from wallpaper (a distributor's ledger should not change colour because the delivery boy set a pink wallpaper — brand consistency and screenshot support beat personalisation here), shape morphing flourishes, and the bouncy `expressive` spring scheme on anything routine.

### 1.2 iOS: Liquid Glass / post-iOS-26

Liquid Glass is Apple's largest visual change since iOS 7. The design idea, not the material, is what transfers: **controls live in a functional layer floating above a content layer, and content leads.** Hierarchy became dynamic — tab bars and toolbars shrink as you scroll into content and expand when you scroll back. ([createwithswift](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/), [learnui.design iOS 26 guidelines](https://www.learnui.design/blog/ios-design-guidelines-templates.html), [Liquid Glass — Wikipedia](https://en.wikipedia.org/wiki/Liquid_Glass))

The counterweight is real: over-applied translucency costs legibility, contrast and GPU. Accessibility writers have been blunt that glass carries genuine contrast risk, and Apple ships Reduce Transparency / Increase Contrast for exactly this. ([designedforhumans](https://designedforhumans.tech/blog/liquid-glass-smart-or-bad-for-accessibility))

In React Native this is available and honest about its limits: `expo-glass-effect`'s `GlassView` is **iOS 26+ only and falls back to a plain opaque `View` on Android and older iOS**; `@callstack/liquid-glass` bridges the same APIs via Fabric with the same fallback. ([Expo GlassEffect docs](https://docs.expo.dev/versions/latest/sdk/glass-effect/), [callstack/liquid-glass](https://github.com/callstack/liquid-glass), [Callstack write-up](https://www.callstack.com/blog/how-to-use-liquid-glass-in-react-native))

**What we take:** the content-leads layering, the scroll-responsive chrome, and *optionally* `GlassView` on exactly two surfaces (the sales app's bottom action bar and the delivery app's stop action bar) where a floating control over a list or map is genuinely the right shape. **What we skip:** glass anywhere text sits on top of it, glass on tables, glass in the warehouse app (sunlight + gloves + a 720p LCD is the worst case for translucency), and any design that *requires* glass to read correctly — because on the budget Android that is our performance floor it will render as a flat opaque box.

### 1.3 The cross-platform rule (avoiding the "bad web wrapper" smell)

One codebase, two platforms. The line that keeps it from feeling wrong on one of them:

| Layer | Rule |
| --- | --- |
| **Ours, identical on both** | Layout, spacing, type scale, colour roles, data density, iconography, copy, the shape of every workflow. |
| **Platform-owned, must differ** | Navigation transitions and back behaviour (Android hardware/gesture back must always work; iOS edge-swipe back must always work), the keyboard and its accessory bar, date/time pickers, share and print sheets, text selection, scroll physics and overscroll, safe-area/edge-to-edge insets, haptic vocabulary. |
| **Never** | `alert()`/`window.confirm`; an Android FAB on iOS; iOS chevron-back rendered on Android; fixed desktop 12-column grids ported to a phone; hover-only affordances; a bottom sheet that ignores the home indicator; text that cannot be selected in a money/ID field. |

The single loudest wrapper tell in a React Native product is **a tap that does not respond within one frame**. Everything in Part 6 is aimed at that.

---

## Part 2 — What genuinely current operational software looks like

Not consumer social; operational and financial tools, which is what we are.

**The shared vocabulary of 2026 B2B (Linear, Stripe, Vercel, Ramp, Mercury, Retool, Attio):**

- **Density comes from typography, not chrome.** Modern admin UI draws few borders; weight, size and whitespace do the grouping. ([925studios — SaaS dashboards 2026](https://www.925studios.co/blog/saas-dashboard-design-examples-2026))
- **Numerals are the real typography decision.** Tabular figures, consistent precision, units set lighter than values — described plainly as the difference between amateur and credible financial UI. ([925studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026), [tabular numbers in B2B pricing tables](https://www.pravinkumar.co/blog/tabular-numbers-webflow-pricing-tables-b2b-2026))
- **One accent, used sparingly.** The discipline in Linear/Raycast/Mercury/Cursor is not the dark mode, it is a single accent colour used with restraint. ([925studios — Linear breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026))
- **Density matched to the mental model.** Ramp's density would be wrong in a consumer app and is expected in corporate finance; applying consumer-fintech patterns (soft pastels, onboarding wizards, gamified progress) to a professional tool creates a mismatch with the user's mental model. ([Masterly — fintech design 2026](https://www.themasterly.com/blog/fintech-design-guide))
- **Speed is a design property.** Linear's stated targets: ~100ms interaction response, optimistic updates, no spinners, view transitions under 100ms, animations kept on the GPU below the cause-and-effect threshold, layout-triggering properties never animated, mutations applied locally and reconciled in the background. ([performance.dev — how is Linear so fast](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [925studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026))
- **Semantic tokens, not hex codes.** Polaris keeps a private primitive scale (`color-sky-100…900`) and exposes only semantic aliases (`--p-color-bg-fill-active`); in 2026 tokens are the handoff contract, with Figma variables mapping to CSS custom properties. ([polaris-tokens changelog](https://github.com/Shopify/polaris-tokens/blob/main/CHANGELOG.md), [Polaris v12](https://polaris.shopify.com/previous-releases/version-12))
- **Triage is keyboard-first and progressively disclosed.** Linear's triage binds `1` accept / `2` decline / `3` duplicate; enterprise review views show decision-critical context first with the full record one interaction away; four-eyes approvals give each approver an independent read path rather than a rubber stamp. ([bulk action UX guidelines](https://www.eleken.co/blog-posts/bulk-actions-ux), [compliance analyst workflow patterns](https://digiwagon.com/blogs/compliance-analyst-workflow-ux-patterns/))

**Indian field UX (Swiggy/Zomato partner, Porter/Dunzo driver):** the design targets are two user segments in one app — the newly onboarded person who needs guidance, and the veteran who needs raw efficiency — served by one screen that opens on the next action rather than a menu. ([Swiggy engineering — delivery partner app](https://bytes.swiggy.com/architecture-and-design-principles-behind-the-swiggys-delivery-partners-app-4db1d87a048a)) That is already our "zero-training UX" rule in `docs/08-frontend-architecture.md`; the point here is that it is also *what current apps in this market actually do*, so it will feel familiar to Tarsun's crew, not novel.

**Money UI (Cash App, Revolut):** the amount is the hero at a size nothing else on the screen touches; currency symbol and decimals are set lighter and smaller than the integer part; state is a word plus an icon plus colour, never colour alone; a pending amount is visibly pending. We inherit the typographic treatment, not the playfulness.

---

## Part 3 — The dated list (what would make our apps look OLD)

Explicitly called out, because avoiding these is most of the work. Several are **in the repo today** and are marked so.

**Structure and chrome**

1. **Dark-navy fixed sidebar + white content pane** — the 2014 admin-template silhouette. *Present today:* `frontend/owner-app/src/styles.css` uses `grid-template-columns: 220px 1fr` with a `#0f172a` sidebar. Replace with a neutral canvas, a collapsible rail, and hierarchy carried by type.
2. **Bootstrap blue as the only colour** with no tonal ramp. *Present today:* `frontend/libs/ui/src/tokens.ts` is `primary #1d4ed8` + Tailwind-slate greys — a safe default, not a design.
3. Border **and** shadow **and** 8px radius on every card, cards nested inside cards, panels inside panels.
4. Breadcrumb bar + centred page title + a row of outlined buttons at top right.
5. Three-level left-nav trees; a hamburger on a desktop viewport.
6. Bottom tab bars with 6+ tabs and truncated labels.
7. A 2-second splash screen with a big logo.

**Visual language**

8. Neumorphism and heavy multi-stop gradients — named as the fastest way to look three years old. ([Stackademic — outdated UI patterns](https://blog.stackademic.com/outdated-ui-design-mistakes-hurting-your-credibility-706495be67cb))
9. Glassmorphism sprayed everywhere instead of on one deliberate floating layer (Part 1.2).
10. Emoji as iconography; mixed icon sets; icons at inconsistent stroke weights.
11. ALL-CAPS wide-tracked labels on every section header (a Material 2 tell).
12. A FAB bottom-right on every screen whether or not there is one primary action (also Material 2).
13. **No dark mode.** In 2026 dark mode is an expectation, not a feature — and our warehouse and delivery users work at 6am and after dusk. ([Bubble — design trends 2026](https://bubble.io/blog/web-design-trends/))
14. Skeuomorphic "paper invoice" backgrounds, drop-shadowed rupee-note motifs, textured header images.

**Data and numbers**

15. **Proportional numerals in money columns**, ₹ set at the same size and weight as the amount, inconsistent decimal precision down a column.
16. A desktop table shrunk onto a phone: horizontal scroll with no frozen key column, no column priority, no card view at small widths. ([Pencil & Paper — enterprise data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), [Setproduct — data table reference 2026](https://www.setproduct.com/blog/data-table-ui-design))
17. `<input type="number">` for money — browser spinners, locale comma rejection, inconsistent decimals. ([Luhr — deep dive on number inputs](https://luhr.co/blog/2025/07/01/a-deep-dive-on-the-ux-of-number-inputs/), [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number))
18. Status shown by **colour alone** — a red chip with no icon and no word.
19. Charts with 3D bars, drop shadows, rainbow default palettes, or a donut with nine slices.
20. A dashboard that opens blank until you pick a date range and a filter.

**Interaction**

21. **A "Sync now" button** — already banned in `docs/08`; extend the ban to "Refresh" as the primary way to get current data.
22. Full-screen blocking modals for sync, GPS or permissions; `alert()`/`confirm()`.
23. A centred spinner as the loading state for a list whose shape we already know. ([LogRocket — skeleton screens](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/))
24. A success toast after every single action; toasts as the only record of what happened.
25. A confirmation dialog in front of every destructive action instead of **undo** for the reversible ones (keep the dialog only for the genuinely irreversible: issuing an invoice, committing a GRN, closing a trip).
26. Routine transitions animated at 400–600ms; page-level "flourish" animations.
27. Hover-dependent affordances (row actions that only appear on hover) with no touch equivalent.

---

## Part 4 — The patterns this product actually needs, done to 2026 standard

### 4.1 Data tables on a phone

The current consensus is a **hybrid keyed to viewport and task**: card view at the smallest widths, horizontal scroll with a **frozen first column** at mid widths, and a **priority+** column model that shows the top columns and reveals the rest on demand — with the deciding factor being whether the user needs to *compare rows* or *read one row*. ([Setproduct](https://www.setproduct.com/blog/data-table-ui-design), [Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), [Eleken — table design UX](https://www.eleken.co/blog-posts/table-design-ux))

Applied here:

| Surface | Pattern |
| --- | --- |
| Ageing 0-30/31-60/61-90/90+ (owner phone, accountant web) | Phone: one card per retailer, name + total outstanding + oldest-bucket chip; tap to the ledger. Web: real table, frozen retailer column, tabular numerals, bucket columns right-aligned. |
| Order lines in the sales editor | Never a table. One row per SKU: name, case/pcs stepper, live line total, `applied_rules` as chips. |
| GST registers, Tally export, stock ledger | Web only, dense table, sticky header + sticky first column, column visibility control, CSV export. Not a phone surface. |
| Picklist (warehouse) | List, grouped by SKU, one line = one pick with lot + FEFO warning; quantity in cases **and** pieces on the same row. |

### 4.2 Number entry — money and quantity

Rules, all sourced: use `inputMode="decimal"` (web) / `keyboardType="decimal-pad"` (native) rather than `type="number"`; **format on blur, not on every keystroke**; show the currency marker so the unit is never ambiguous; prefer a **stepper** for small integer adjustments because it costs one tap versus focus-type-dismiss. ([UX Patterns — currency input](https://uxpatterns.dev/patterns/forms/currency-input), [CSS-Tricks — inputmode](https://css-tricks.com/finger-friendly-numerical-inputs-with-inputmode/), [NN/g — input steppers](https://www.nngroup.com/articles/input-steppers/))

Our specifics, on top of the existing `RupeeInput`/`Money` primitives (paise in, paise out):

- **Money never leaves paise.** Display formats with `Intl.NumberFormat('en-IN')`; the integer part is the hero, `₹` and the paise are one step down in size and one step lighter.
- **Quantity is always dual-unit.** The stepper shows `2 case = 180 pcs` inline (already in `docs/08`); `+`/`−` step by **case**, long-press opens a keypad for pieces. Case size comes from `tenant_products.case_size_override` else `product_variants.default_case_size`.
- **The keypad is the input**, not a text field, on every field-staff numeric entry (order qty, gate count, cash collected, declared cash). The web console keeps a real text field because there is a keyboard.
- **No silent clamping.** If a quantity exceeds ATP or a discount exceeds the rep's bound, the field accepts it and the screen explains what will happen (approval required / blocked), rather than snapping the number back.

### 4.3 Scanning (supplier invoice, EAN/QR)

Current practice: continuous decode with immediate on-device feedback, batch/buffer the results and sync later, and enforce scan checkpoints at each stage rather than one. Note the honest constraint that phone-camera scanning is materially slower than a dedicated scanner and becomes the bottleneck at high pick rates. ([Cleverence — barcode scanner apps 2026](https://www.cleverence.com/articles/business-blogs/barcode-scanner-app-2026-4729/), [upzoneHQ — warehouse scanning 2026](https://upzonehq.com/blog/best-barcode-scanning-apps-warehouse-operations/))

Applied: camera fills the screen with a **reticle, not a full-screen mask**; a decoded item produces *selection* haptic + a chip that animates into a growing "scanned" stack; scanning never leaves the screen; a running count is always visible; ambiguity (two SKUs share an EAN) surfaces as a chooser, never a silent pick. For invoice capture, shoot at full quality, show the page thumbnails as a filmstrip, and let the reviewer crop per row — the review screen is the product, not the camera.

### 4.4 Multi-step commit flows (pick → pack → invoice; capture → review → GRN)

- **One screen per step, with a persistent step indicator that shows where the commit point is.** Everything before the commit is editable and reversible; the commit is a single explicit, labelled action ("Post GRN", "Issue invoice") with a summary of exactly what will be written.
- **Never a wizard modal.** These are work surfaces people leave and come back to; state must survive a phone call and an app kill (`docs/08`).
- **The irreversible step gets the confirmation dialog** and a `notificationAsync(Success)` haptic; every reversible step gets undo instead.
- **Short-packs are rows, not edits** (`pack_confirmations`), and the UI must show the original ask beside the packed quantity rather than overwriting it — the audit trail is visible in the interface, not only in the database.

### 4.5 Approval queues (owner, manager)

Model on triage, not on an inbox: a queue where each item shows the decision-critical facts first (who, how much, against what limit, what the rule says) with the full order/ledger one tap away, an obvious **approve / reject / ask** action pair, **bulk select with an explicit count and an undo window**, and keyboard bindings on web (`j`/`k` to move, `1`/`2` to decide, `⌘K` for everything else). ([Eleken — bulk action UX](https://www.eleken.co/blog-posts/bulk-actions-ux), [compliance workflow patterns](https://digiwagon.com/blogs/compliance-analyst-workflow-ux-patterns/), [Linear breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026))
Rejections carry a reason code, and the requester sees the reason — a silent reject is what makes staff stop trusting an approval queue.

### 4.6 Charts in the dashboard

The founder specifically asked for growth graphs in the owner app, so this needs a real answer for React Native **and** web from one codebase.

State of the libraries: **Victory Native (XL)** is a from-scratch RN rewrite on React Native Skia + Reanimated + Gesture Handler, GPU-accelerated and smooth on low-end devices — but it **does not officially support web**, and the recommended pairing is Victory (web) alongside Victory Native (mobile). **Recharts** is the common choice when one codebase must render on both via React Native Web, at a performance cost. ([LogRocket — RN chart libraries](https://blog.logrocket.com/top-react-native-chart-libraries/), [PkgPulse — Victory Native vs alternatives 2026](https://www.pkgpulse.com/guides/victory-native-vs-react-native-chart-kit-vs-echarts-rn-2026), [Victory Native tutorial 2026](https://reactnativerelay.com/article/react-native-charts-victory-native-interactive-data-visualizations-expo))

**Recommendation:** a `Chart` component in `frontend-apps/shared-ui` with a platform split — `Chart.native.tsx` (Victory Native / Skia) and `Chart.web.tsx` (Recharts or hand-drawn SVG) — behind **one props contract**, so screens never import a chart library directly. Sparklines, single-series bars and the trend line in KPI tiles should be **hand-drawn with `react-native-svg`** (which renders on web through RN-Web): they are ~40 lines, have no bundle cost, and avoid the whole compatibility question for the 80% case.

Chart rules: no 3D, no shadows, no rainbow palette; one accent plus neutrals; a category colour is always paired with a label or icon (never colour-only); tabular numerals on all axis and value labels; y-axes on money start at zero; lakh/crore formatting via `Intl.NumberFormat('en-IN')` with a manual fallback; every chart states its date range and its "as of" time on the chart, not in a tooltip.

### 4.7 Sync and connection state — shown honestly

Current pattern set: a subtle "Syncing…" chip rather than a blocking state; a "last synced" timestamp; an "unsynced changes" badge on the specific items pending upload; retry affordances on failure; and **data-age treatment that escalates** — fresh data unmarked, minutes-old shown as a relative timestamp, hours-old shown with a subtle warning accent, day-old shown as an amber warning. Network failure shows a plain "connection lost" state with a retry and a path to cached content, not an angry red error. ([mobile UX patterns 2026](https://www.sanjaydey.com/mobile-ux-ui-design-patterns-2026-data-backed/), [Power Apps offline sync icon](https://learn.microsoft.com/en-us/power-apps/mobile/offline-sync-icon), [offline-first architecture](https://medium.com/@ahmed.ally2/offline-first-architecture-for-android-developers-designing-for-reality-not-just-the-cloud-e40d1dcc85ac))

Our contract (works today online-first, unchanged when PowerSync lands for sales+delivery):

- **One status dot in the header**, three states with a word on tap: `Synced · 2 min ago` / `3 changes waiting` / `Offline — since 10:42`. No spinner, no button.
- **Per-row provenance.** An order created offline carries a small "waiting" mark until the server acknowledges it. When `/sync/upload` returns a `sync_errors` row (the protocol never answers 4xx — ADR 0007), that row becomes a **"Needs attention" item with the business reason in plain English**, not a toast.
- **Stale prices are labelled.** A price quoted from a cached price list older than the current session shows "prices as of <time>" on the order screen — this is exactly the doorstep dispute in `docs/domain/operational-pain-points.md` #27.
- **Never a modal.** Sync, GPS and permission states are inline banners or chips (already `docs/08`).

### 4.8 Optimistic UI — where yes, where no

Optimistic-by-default is the current expectation for anything the client can validate locally. But we handle money and legal documents, so:

| Action | Treatment |
| --- | --- |
| Add/remove/adjust an order line, check in at a shop, mark a visit, edit a draft | Fully optimistic, instant, undo available. |
| Submit an order | Optimistic to `submitted` with a waiting mark; server recompute may change prices, and the diff is surfaced as a "Needs attention" item. |
| Deliver / partial / fail a stop, record a receipt | Optimistic locally (the crew must not wait on 4G) and durable in the local queue; the receipt shows a client receipt number immediately and the server number when it lands. |
| **Issue an invoice, post a GRN, close a trip, approve a credit override** | **Never optimistic.** These take a number from a series, write ledgers, and are irreversible. Show a determinate in-progress state on the button, block double-submit via the `idempotencyKey`, and only then show the number. |

---

## Part 5 — Haptics

### 5.1 What the platforms actually give us

**Expo (`expo-haptics`, current SDK):** `impactAsync(style)` with `ImpactFeedbackStyle` = `Light | Medium | Heavy | Rigid | Soft`; `notificationAsync(type)` with `NotificationFeedbackType` = `Success | Warning | Error`; `selectionAsync()`; and Android-only `performAndroidHapticsAsync(type)` with `AndroidHaptics` = `Clock_Tick, Confirm, Context_Click, Drag_Start, Gesture_End, Gesture_Start, Keyboard_Press, Keyboard_Release, Keyboard_Tap, Long_Press, No_Haptics, Reject, Segment_Frequent_Tick, Segment_Tick, Text_Handle_Move, Toggle_Off, Toggle_On, Virtual_Key, Virtual_Key_Release`. The Android `VIBRATE` permission is added automatically. ([Expo Haptics API reference](https://docs.expo.dev/versions/latest/sdk/haptics/), [expo-haptics on npm](https://www.npmjs.com/package/expo-haptics))

The first three map onto iOS's `UIFeedbackGenerator` family (impact / notification / selection); Core Haptics (custom `CHHapticPattern`s) is *not* exposed by `expo-haptics` and we do not need it. On Android, `performAndroidHapticsAsync` routes to the platform's `HapticFeedbackConstants`, which is what Google asks you to prefer over raw `VibrationEffect`.

**Android's official principles** ([developer.android.com — haptics design principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles)):

- Prefer action-oriented `HapticFeedbackConstants` over raw effects — it gives consistency plus a graceful fallback on devices with weak actuators.
- Avoid legacy one-shot vibrations (`VibrationEffect.createOneShot()`, `Vibrator.vibrate(long)`); avoid buzzy feedback — choose *no* haptic over a buzzy one.
- Intensity scales inversely with frequency: very frequent events (scroll ticks, text handles) = very subtle; moderate (toggles) = moderate; important (form submission, refresh) = stronger.
- "Less is more" — excessive vibration is numbing and distracting; keep haptics in sync with the visual and audio; a good keyclick is 10–20ms.

**Apple's HIG** says the same in different words: haptics *reinforce* an action rather than replace visual feedback, must be used consistently and sparingly, must respect the user's system settings, and are one channel among colour, text and sound — using several reaches more people. ([HIG — Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics), [HIG — Feedback](https://developer.apple.com/design/human-interface-guidelines/patterns/feedback/))

### 5.2 The rule for an app people use eight hours a day

The failure mode for a work app is **haptic fatigue**: a salesman adding 40 lines to an order and a picker scanning 200 items will feel hundreds of buzzes an hour. The discipline: haptics mark **state changes and outcomes**, not keystrokes.

**Our haptic map** (one table, enforced in the UI kit — screens call `haptics.confirm()`, never `Haptics.impactAsync` directly):

| Moment | Effect | Why |
| --- | --- | --- |
| Stepper `+`/`−`, segment/tab change, picker tick | `selectionAsync()` (Android: `Clock_Tick`) | Very frequent → very subtle. |
| Barcode decoded, item added to pick stack | `selectionAsync()` | Frequent, must be felt without being watched. |
| Toggle a switch, select a row in a bulk queue | `impactAsync(Light)` (Android: `Toggle_On`/`Toggle_Off`) | Moderate frequency, moderate strength. |
| Long-press opens keypad / drag starts | `impactAsync(Medium)` (Android: `Long_Press` / `Drag_Start`) | Marks a gesture boundary. |
| Order submitted, stop delivered, receipt recorded, GRN posted, invoice issued, trip settled | `notificationAsync(Success)` | Low frequency, high importance — the only "strong" haptics in the product. |
| Approval blocked (credit stop, over-limit, MOV), scan rejected, sync error | `notificationAsync(Error)` (Android: `Reject`) | The user must not walk away thinking it worked. |
| Settlement variance outside tolerance, near-expiry warning at commit | `notificationAsync(Warning)` | Between the two. |
| **Nothing else.** No haptic on navigation, list scroll, keyboard digits, screen load, toast, or pull-to-refresh start. | — | "Less is more"; buzzy > no haptic is false. |

Plus:

- **A settings toggle: Haptics — Full / Important only / Off**, defaulting to Full, persisted per device. Apple and Android both ask for haptics to be optional and adjustable; a delivery rider on a bike gets a different answer than an accountant at a desk.
- **Never the only channel.** Every haptic is paired with a visual state change and, where it matters (scan reject, settlement red), a word.
- **Web gets nothing.** The Vibration API on Android Chrome is a buzz, not a haptic — the console and the retailer PWA use motion and colour only.
- **Test on real hardware at both ends.** Perceived feel varies enormously between a Taptic Engine and a ₹9,000 Android's rotary actuator; the pilot devices are the acceptance test. ([Meta Horizon — haptics best practices](https://developers.meta.com/horizon/design/haptics-best-practices/))

---

## Part 6 — Motion and perceived performance

### 6.1 Motion budget

Anchored on the M3 tokens (Part 1.1), narrowed to what a work app should use:

| Class | Duration | Easing | Examples |
| --- | --- | --- | --- |
| Micro-feedback | 50–100ms (`short1`/`short2`) | `standard` | Press states, checkbox, chip select, stepper bump. |
| Element enter/exit | 150–200ms (`short3`/`short4`) | `standard.decelerate` in, `standard.accelerate` out | Row insert, chip appear, banner. |
| Surface / sheet | 250–300ms (`medium1`/`medium2`) | `emphasized.decelerate` / `emphasized.accelerate` | Bottom sheet, dialog, drawer. |
| Screen transition | 300ms max | platform default | Route push/pop — let the navigator own it. |
| **Never** | >400ms on anything routine; any decorative loop; anything animating `width`/`height`/`top`/`left` | — | Linear's rule: keep animation on the GPU (transform/opacity), never animate layout-triggering properties. ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)) |

**Springs where they earn it** (sheets, the FAB→sheet morph, the swipe-action snap) using Reanimated's spring with M3's *standard* scheme feel — higher damping, minimal overshoot. The *expressive* low-damping bounce belongs to consumer apps; a bouncy invoice reads as unserious.

**Reduced motion is mandatory, not optional.** React Native exposes `AccessibilityInfo.isReduceMotionEnabled()` (backed by `UIAccessibility.isReduceMotionEnabled` on iOS and `Settings.Global.TRANSITION_ANIMATION_SCALE` on Android) plus a `reduceMotionChanged` event; Reanimated ships `useReducedMotion()` and `ReduceMotion.System`, which disables the animation when the OS setting is on. Web uses `prefers-reduced-motion`. Rule: **every animation in the UI kit declares `ReduceMotion.System`**, and reduced motion means cross-fade or instant, never "same animation, slower". ([RN AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo), [Reanimated useReducedMotion](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/), [Reanimated accessibility guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/))

### 6.2 Perceived performance on a budget Android

The floor is real: India's sub-$100 segment collapsed to ~4.5% share in Q2 2026 (from 15.6%), and rising memory prices are pushing manufacturers to strip budget phones back to 4GB RAM rather than raise prices — so a ₹10–15k phone with 4GB RAM, a 720p 90Hz LCD and patchy 4G is exactly what Tarsun's staff will be holding. ([Business Today — memory prices and 4G phones, Aug 2026](https://www.businesstoday.in/technology/news/story/top-4g-phones-you-can-buy-as-memory-prices-push-up-smartphone-costs-548715-2026-08-15))

Our stack: Expo SDK 57 / React Native 0.86 (New Architecture mandatory since SDK 55), Reanimated 4.5, Worklets 0.10, Gesture Handler 2.32. Note `expo@57.0.17` / RN 0.86.3 resolves the Hermes V1 memory regression from SDK 56 that inflated memory in apps importing Reanimated/Worklets — **pin at or above that patch**, because on 4GB devices that regression is the difference between running and being killed. ([Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57), [Expo New Architecture guide](https://docs.expo.dev/guides/new-architecture/))

The perception rules:

- **Loading is threshold-based, not one-size:** <300ms show nothing (do not flash a spinner); 300ms–1s a subtle inline indicator; >1s a **skeleton shaped like the content that is coming**. Skeletons are perceived as materially faster than spinners for the same real duration because they point at the content rather than at the wait. ([LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/), [OneThing — skeletons vs spinners](https://www.onething.design/post/skeleton-screens-vs-loading-spinners))
- **Never a full-screen spinner on a screen whose layout we already know.** Beat list, stop list, order queue, GRN queue, retailer catalog all have known shapes.
- **Every screen opens on cached data first** (TanStack Query persisted cache online-first, PowerSync later) and refreshes underneath, with the data-age treatment from 4.7.
- **Lists are virtualised** (`FlashList`/`FlatList` with stable `keyExtractor`, fixed row heights where possible, no inline anonymous render functions). A distributor's catalog is thousands of SKUs and the ageing list is hundreds of retailers.
- **Images:** invoice photos are captured at full quality for extraction but never rendered at full resolution in a list — thumbnails only, with `expo-image` caching.
- **Search is local-first and debounced** against the on-device catalog; a network round trip per keystroke on 4G is what makes competitors feel slow (Bizom's documented "internet-dependent, slow at EOD" complaint, `docs/design/CONTEXT.md`).
- **Interaction target ~100ms.** A tap must produce a visible state change within one frame, even when the work behind it takes seconds — press state, then optimistic result or determinate progress. ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown))

---

## Part 7 — Rules this product adopts

Each rule: what to do, why, source. These are written to be checkable in review.

**Foundations**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R1 | Colours exist only as **semantic tokens** (`bg.surface`, `text.secondary`, `state.warning.fg`) generated from a private primitive ramp in `tokens.json`; no screen writes a hex value. | Tokens are the 2026 handoff contract; a flat palette of nine hexes cannot express hover/pressed/disabled/dark without ad-hoc colours. | [Polaris tokens](https://github.com/Shopify/polaris-tokens/blob/main/CHANGELOG.md), [Polaris v12](https://polaris.shopify.com/previous-releases/version-12) |
| R2 | **One accent colour**, used for the primary action and for the selected state only. Status colours are their own semantic family and never compete with the accent. | Single-accent restraint is the shared discipline of current B2B design. | [925studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) |
| R3 | **Dark mode is shipped**, defined at token level, not a filter — with the delivery and warehouse apps defaulting to system. | Dark mode is a 2026 expectation; our users work before dawn and after dusk. | [Bubble](https://bubble.io/blog/web-design-trends/) |
| R4 | **Inter (or IBM Plex Sans) variable**, one family, with **tabular figures on every number**. `₹` and paise set smaller and lighter than the integer part; fixed precision down a column. | Inter defaults to tabular figures; column alignment is the credibility signal in financial UI. | [Inter font](https://madegooddesigns.com/inter-font/), [tabular numbers B2B](https://www.pravinkumar.co/blog/tabular-numbers-webflow-pricing-tables-b2b-2026), [fintech fonts 2026](https://fontalternatives.com/best-fonts-for/fintech/) |
| R5 | Density from typography and spacing; **borders used sparingly, shadows almost never**. No card inside a card. | Modern admin UI groups with weight and whitespace, not chrome. | [925studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) |
| R6 | **Touch targets ≥48dp** for field apps (keep the existing `touch.minTarget = 48`), ≥44pt on iOS controls, and never below WCAG 2.2 SC 2.5.8's 24×24 CSS px on the web console. | 2.5.8 is Level AA; Apple asks 44pt, Material asks 48dp; our users wear gloves and stand in the sun. | [W3C SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [target size guide](https://testparty.ai/blog/wcag-target-size-guide) |
| R7 | **State = colour + icon + word**, always all three. | Colour-only encoding fails for colour-blind users, in sunlight, and on a cheap LCD. | [Apple HIG — Feedback](https://developers.apple.com/design/human-interface-guidelines/patterns/feedback/) |
| R8 | Strings live in `shared-ui/strings.ts` as keys with English values today. **No i18n library, no language toggle in the header yet.** | Founder constraint; keeping strings isolated makes the later Hindi/Marathi pass mechanical. Supersedes the "Hindi/English toggle in every header" line in `docs/08` for now. | Founder, 2026-09-04 |

**Platform**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R9 | Ours is the layout, type, colour and workflow — **the platform owns navigation transitions, back behaviour, keyboards, pickers, share/print sheets, scroll physics and safe areas**. | This single split is what separates a native-feeling cross-platform app from a web wrapper. | Part 1.3 |
| R10 | Adopt M3's **content-leads layering and scroll-responsive chrome** on both platforms; adopt Liquid Glass *material* on at most two floating action bars (sales, delivery), never behind text or tables, with a solid fallback verified on Android. | `GlassView` is iOS 26+ and silently falls back to an opaque `View`; a design that needs glass to read will break on our floor device. | [Expo GlassEffect](https://docs.expo.dev/versions/latest/sdk/glass-effect/), [createwithswift](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/), [accessibility caveat](https://designedforhumans.tech/blog/liquid-glass-smart-or-bad-for-accessibility) |
| R11 | **No dynamic colour from wallpaper**, no shape morphing, no expressive bounce on routine UI. | Brand consistency, screenshot support and seriousness for a system of record. | Part 1.1 |
| R12 | Android is **edge-to-edge**; iOS respects the home indicator; every sheet, action bar and keypad accounts for insets. | RN 0.86 continues edge-to-edge fixes on Android; ignoring insets is the most visible wrapper tell. | [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) |

**Motion**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R13 | Motion tokens are the M3 durations/easings (Part 6.1). Routine UI never exceeds **300ms**; screen transitions are the navigator's. | Real, published values; long transitions read as slow, not as polished. | [material-tokens motion.json](https://github.com/material-foundation/material-tokens/blob/json/json/motion.json) |
| R14 | Animate **transform and opacity only**. Never `width`, `height`, `top`, `left`, or layout-affecting props. | Keeps animation on the GPU; layout animation is what drops frames on a 4GB Android. | [performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) |
| R15 | Every animation declares `ReduceMotion.System`; reduced motion means **cross-fade or instant**, never a slowed-down version. | RN and Reanimated expose the OS setting directly; ignoring it is an accessibility failure. | [Reanimated useReducedMotion](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/), [RN AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo) |

**Performance**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R16 | Loading thresholds: **<300ms nothing, 300ms–1s inline indicator, >1s content-shaped skeleton.** No full-screen spinner on any known-shape screen. | Skeletons are perceived as substantially faster than spinners at the same real duration. | [LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/), [OneThing](https://www.onething.design/post/skeleton-screens-vs-loading-spinners) |
| R17 | Every list screen renders **cached data first**, refreshes underneath, and labels data age (Part 4.7). | The "internet-dependent, slow at EOD" complaint against Bizom is exactly this failure. | `docs/design/CONTEXT.md`, [offline-first patterns](https://medium.com/@ahmed.ally2/offline-first-architecture-for-android-developers-designing-for-reality-not-just-the-cloud-e40d1dcc85ac) |
| R18 | All long lists virtualised; images thumbnailed and cached; search debounced against local data. Pin Expo ≥ `57.0.17` (RN 0.86.3) for the Hermes memory fix. | 4GB RAM budget Androids are the floor and the SDK 56 regression inflated memory in Reanimated apps. | [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57), [Business Today, Aug 2026](https://www.businesstoday.in/technology/news/story/top-4g-phones-you-can-buy-as-memory-prices-push-up-smartphone-costs-548715-2026-08-15) |
| R19 | **Every tap changes something visible within one frame**, even when the work takes seconds. | The ~100ms interaction target is the difference between "fast app" and "old app". | [performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) |

**Data, numbers and tables**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R20 | Phones get **cards or priority-column lists**; real tables exist only on the web console, with a sticky header, a frozen first column and column visibility control. | The hybrid keyed to "does the user need to compare rows" is the current consensus. | [Setproduct](https://www.setproduct.com/blog/data-table-ui-design), [Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) |
| R21 | Numeric entry uses `decimal-pad` / `inputMode="decimal"`; **never `<input type="number">`**; format on blur; currency marker always visible. | Documented failures of `type=number` with locale separators and steppers. | [UX Patterns currency input](https://uxpatterns.dev/patterns/forms/currency-input), [Luhr](https://luhr.co/blog/2025/07/01/a-deep-dive-on-the-ux-of-number-inputs/), [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number) |
| R22 | Quantities use a **stepper stepping by case, showing "N case = M pcs"**, with long-press to a keypad for pieces. | Steppers cost one tap versus focus-type-dismiss; case/pcs confusion is pain point #6. | [NN/g input steppers](https://www.nngroup.com/articles/input-steppers/), `docs/domain/operational-pain-points.md` |
| R23 | Charts: `Chart.native.tsx` (Victory Native/Skia) + `Chart.web.tsx` (Recharts/SVG) behind one props contract; sparklines and simple bars hand-drawn in `react-native-svg`. No 3D, no shadows, no rainbow palettes, no >5-slice donuts. | Victory Native has no official web support; one contract keeps screens library-agnostic. | [LogRocket RN charts](https://blog.logrocket.com/top-react-native-chart-libraries/), [PkgPulse 2026](https://www.pkgpulse.com/guides/victory-native-vs-react-native-chart-kit-vs-echarts-rn-2026) |
| R24 | Money is formatted with `Intl.NumberFormat('en-IN')` from paise, with the lakh/crore fallback in `@dos/domain`. Never a float, never a client-side rounding. | Existing architecture rule; also the credibility point in R4. | `CLAUDE.md`, `shared/domain` |

**Interaction and honesty**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R25 | **No "Sync now" and no "Refresh" as the primary path to current data.** One status chip: synced + age / N waiting / offline since. | Already a product rule; the pattern set in 2026 is a passive chip plus per-item badges. | `docs/08`, [Power Apps sync icon](https://learn.microsoft.com/en-us/power-apps/mobile/offline-sync-icon), [mobile UX 2026](https://www.sanjaydey.com/mobile-ux-ui-design-patterns-2026-data-backed/) |
| R26 | **Undo for the reversible, a dialog only for the irreversible** (issue invoice, post GRN, close trip, approve override). Optimistic UI everywhere except those. | Confirmation-dialog-everywhere is the dated pattern; irreversible ledger writes genuinely need a gate. | Part 4.8, [Linear patterns](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) |
| R27 | **No modal ever blocks on sync, GPS or permission.** Inline banner or chip; the user keeps working. | Existing zero-training rule; also what field-app complaints are about. | `docs/08`, `docs/research/R01 §5` |
| R28 | Every screen **opens on the most likely next action** (today's beat, next stop, GRN queue, reorder), not on a menu or a filter form. | Both the zero-training rule and how current Indian field apps are built for the veteran-plus-newcomer split. | `docs/08`, [Swiggy engineering](https://bytes.swiggy.com/architecture-and-design-principles-behind-the-swiggys-delivery-partners-app-4db1d87a048a) |
| R29 | Approval queues are **triage**: decision facts first, full record one tap away, approve/reject/ask, bulk select with an explicit count and an undo window, reason codes on reject, keyboard bindings on web. | Current triage/bulk-action practice; silent rejects destroy trust in the queue. | [Eleken bulk actions](https://www.eleken.co/blog-posts/bulk-actions-ux), [compliance workflow patterns](https://digiwagon.com/blogs/compliance-analyst-workflow-ux-patterns/) |
| R30 | Errors are stated in **business language with the next action** ("Credit limit reached — ₹12,400 over. Ask owner to approve?"), never a code or a red toast that disappears. | `sync_errors` are 2xx business outcomes by design (ADR 0007); the UI must treat them as work items. | `docs/adr/0007-sync-protocol.md` |
| R31 | The web console is **keyboard-operable end to end**: `⌘K` command palette, `j`/`k` list movement, `1`/`2` decide in queues, `/` to search, Esc to close. | Keyboard-first is the defining property of current operational tools, and the accountant/manager live in this app all day. | [performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [925studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) |

**Haptics**

| # | Rule | Reason | Source |
| --- | --- | --- | --- |
| R32 | Screens call a **`haptics.*` façade** in `shared-ui` (`select`, `toggle`, `gestureStart`, `success`, `warning`, `error`), never `expo-haptics` directly. The map in Part 5.2 is the whole vocabulary. | Consistency across six apps; makes the Full/Important/Off setting and the web no-op single-point changes. | [Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) |
| R33 | Strength scales **inversely with frequency**: selection ticks subtle, toggles moderate, outcomes (order submitted, delivered, GRN posted, invoice issued) strong and rare. | Android's published frequency/strength guidance; prevents fatigue over an 8-hour shift. | [Android haptics principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles) |
| R34 | On Android prefer `performAndroidHapticsAsync` with `AndroidHaptics` constants over generic impacts where a matching constant exists (`Confirm`, `Reject`, `Toggle_On/Off`, `Long_Press`, `Clock_Tick`). | Google asks for action-oriented constants: system consistency plus graceful fallback on weak actuators. | [Android haptics principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles), [Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) |
| R35 | **No haptics on** navigation, scroll, keyboard digits, screen load, toast, or refresh start. Prefer no haptic over a buzzy one. | "Less is more"; buzzy feedback is worse than silence. | [Android haptics principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles) |
| R36 | Haptics setting (**Full / Important only / Off**), default Full, per device; haptics are never the only signal; web has none. | Apple and Android both require haptics to be optional and to reinforce rather than replace. | [HIG — Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics), [Meta haptics best practices](https://developers.meta.com/horizon/design/haptics-best-practices/) |

**Enforcement**

| # | Rule | Reason |
| --- | --- | --- |
| R37 | The dated list in Part 3 becomes a **design review checklist**; a screen ships only after it is walked. | Most of "looking current" is not doing the 27 things. |
| R38 | Lint/CI: no hex literals outside `tokens.json`; no `Haptics.` import outside `shared-ui/haptics.ts`; no chart library import outside `shared-ui/chart/`; no animation without a `ReduceMotion` argument; no `type="number"`. | The rules above only survive if a machine checks them, given one developer and six apps. |
| R39 | Every app is **screenshotted on the floor device** (a ₹10–15k 4GB Android, 720p) and on an iPhone before a module is called stable, in both light and dark. | The floor device is the design target, not the fallback. |

---

## Open questions for the founder

1. **Dark mode default** per app: system-follow everywhere, or dark-default for delivery/warehouse (early-morning and evening work) and light-default for owner/accountant?
2. **Glass on iOS**: adopt the material on the two floating action bars, or stay fully custom on both platforms for one visual language? (Fully custom is cheaper to maintain and impossible to get wrong on Android.)
3. **Typeface**: Inter (free, tabular by default, best-in-class for dense data) vs IBM Plex Sans (free, slightly warmer). Either survives the later Devanagari pass via Noto Sans Devanagari.
4. **Accent colour**: the current `#1d4ed8` is a placeholder. A distinct accent is one of the cheapest ways to stop looking like a template — worth ten minutes of the founder's opinion.
5. **Six apps vs five services** — see the note at the top; this affects how the shared shell and role switcher are built.

---

## Sources

Platform standards
- [Motion — Material Design 3](https://m3.material.io/styles/motion/) · [Easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) · [material-foundation/material-tokens motion.json](https://github.com/material-foundation/material-tokens/blob/json/json/motion.json)
- [Material 3 Expressive deep dive — Android Authority](https://www.androidauthority.com/google-material-3-expressive-features-changes-availability-supported-devices-3556392/) · [M3 Expressive components, motion, shapes — supercharge.design](https://supercharge.design/blog/material-3-expressive)
- [Liquid Glass — Wikipedia](https://en.wikipedia.org/wiki/Liquid_Glass) · [Liquid Glass: hierarchy, harmony, consistency — Create with Swift](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/) · [iOS 26 design guidelines — Learn UI Design](https://www.learnui.design/blog/ios-design-guidelines-templates.html) · [Liquid Glass and accessibility](https://designedforhumans.tech/blog/liquid-glass-smart-or-bad-for-accessibility)
- [Expo GlassEffect](https://docs.expo.dev/versions/latest/sdk/glass-effect/) · [callstack/liquid-glass](https://github.com/callstack/liquid-glass) · [How to use Liquid Glass in React Native — Callstack](https://www.callstack.com/blog/how-to-use-liquid-glass-in-react-native) · [Liquid Glass with Expo UI and SwiftUI](https://expo.dev/blog/liquid-glass-app-with-expo-ui-and-swiftui)

Haptics
- [Expo Haptics API reference](https://docs.expo.dev/versions/latest/sdk/haptics/) · [expo-haptics — npm](https://www.npmjs.com/package/expo-haptics)
- [Haptics design principles — Android Developers](https://developer.android.com/develop/ui/views/haptics/haptics-principles)
- [Playing haptics — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/playing-haptics) · [Feedback — Apple HIG](https://developers.apple.com/design/human-interface-guidelines/patterns/feedback/)
- [Haptics best practices — Meta Horizon OS](https://developers.meta.com/horizon/design/haptics-best-practices/)

Motion, accessibility, performance
- [AccessibilityInfo — React Native](https://reactnative.dev/docs/accessibilityinfo) · [useReducedMotion — Reanimated](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/) · [Accessibility — Reanimated](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/)
- [WCAG 2.2 SC 2.5.8 Target Size (Minimum) — W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [WCAG target size guide — TestParty](https://testparty.ai/blog/wcag-target-size-guide)
- [How is Linear so fast — performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)
- [Skeleton loading screen design — LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/) · [Skeleton screens vs loading spinners — OneThing](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) · [React Native's New Architecture — Expo](https://docs.expo.dev/guides/new-architecture/)
- [Memory prices push up smartphone costs — Business Today, Aug 2026](https://www.businesstoday.in/technology/news/story/top-4g-phones-you-can-buy-as-memory-prices-push-up-smartphone-costs-548715-2026-08-15)

B2B / operational design
- [Linear design breakdown — 925studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) · [SaaS dashboard design 2026 — 925studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) · [Fintech design trends 2026 — Masterly](https://www.themasterly.com/blog/fintech-design-guide)
- [polaris-tokens CHANGELOG](https://github.com/Shopify/polaris-tokens/blob/main/CHANGELOG.md) · [Polaris version 12](https://polaris.shopify.com/previous-releases/version-12)
- [Enterprise data tables — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) · [Data table UI reference 2026 — Setproduct](https://www.setproduct.com/blog/data-table-ui-design) · [Table design UX — Eleken](https://www.eleken.co/blog-posts/table-design-ux)
- [Bulk action UX — Eleken](https://www.eleken.co/blog-posts/bulk-actions-ux) · [Compliance analyst workflow UX patterns — DigiWagon](https://digiwagon.com/blogs/compliance-analyst-workflow-ux-patterns/)
- [Architecture and design principles behind Swiggy's Delivery Partners app](https://bytes.swiggy.com/architecture-and-design-principles-behind-the-swiggys-delivery-partners-app-4db1d87a048a)

Inputs, charts, typography, offline
- [Currency input pattern — UX Patterns for Developers](https://uxpatterns.dev/patterns/forms/currency-input) · [Design guidelines for input steppers — NN/g](https://www.nngroup.com/articles/input-steppers/) · [A deep dive on the UX of number inputs — David Luhr](https://luhr.co/blog/2025/07/01/a-deep-dive-on-the-ux-of-number-inputs/) · [Finger-friendly numerical inputs with inputmode — CSS-Tricks](https://css-tricks.com/finger-friendly-numerical-inputs-with-inputmode/) · [input type=number — MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number)
- [Top React Native chart libraries — LogRocket](https://blog.logrocket.com/top-react-native-chart-libraries/) · [Victory Native vs alternatives 2026 — PkgPulse](https://www.pkgpulse.com/guides/victory-native-vs-react-native-chart-kit-vs-echarts-rn-2026) · [Victory Native tutorial 2026](https://reactnativerelay.com/article/react-native-charts-victory-native-interactive-data-visualizations-expo)
- [Inter font — Made Good Designs](https://madegooddesigns.com/inter-font/) · [Tabular numbers in B2B tables](https://www.pravinkumar.co/blog/tabular-numbers-webflow-pricing-tables-b2b-2026) · [Best fonts for fintech 2026 — FontAlternatives](https://fontalternatives.com/best-fonts-for/fintech/)
- [Offline sync icon — Microsoft Power Apps](https://learn.microsoft.com/en-us/power-apps/mobile/offline-sync-icon) · [Offline-first architecture for Android](https://medium.com/@ahmed.ally2/offline-first-architecture-for-android-developers-designing-for-reality-not-just-the-cloud-e40d1dcc85ac) · [Mobile UX/UI patterns 2026](https://www.sanjaydey.com/mobile-ux-ui-design-patterns-2026-data-backed/)
- [Barcode scanner apps 2026 — Cleverence](https://www.cleverence.com/articles/business-blogs/barcode-scanner-app-2026-4729/) · [Barcode scanning for warehouse operations 2026 — upzoneHQ](https://upzonehq.com/blog/best-barcode-scanning-apps-warehouse-operations/)

Dated patterns
- [Outdated UI design mistakes — Stackademic](https://blog.stackademic.com/outdated-ui-design-mistakes-hurting-your-credibility-706495be67cb) · [Why your app design looks outdated — Sean Weldon](https://www.sean-weldon.com/blog/2026-05-01-why-your-app-design-looks-outdated-and-how-to-fix-it) · [Web design trends 2026 — Bubble](https://bubble.io/blog/web-design-trends/)

Repo (internal)
- `docs/01-positioning-and-standout-features.md`, `docs/02-five-apps-and-surfaces.md`, `docs/06-order-to-cash-flows.md`, `docs/08-frontend-architecture.md`, `docs/adr/0007-sync-protocol.md`, `docs/domain/operational-pain-points.md`, `docs/design/CONTEXT.md`, `frontend/owner-app/src/styles.css`, `frontend/libs/ui/src/tokens.ts`
