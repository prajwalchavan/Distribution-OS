# UX-01 — Field reality: the six users, their physical conditions, and the interface rules that follow

Date: 2026-09-04. Author: design-research subagent. Scope: the physical and human reality of the six Distribution OS users in India (Kalyan / Mumbai Metropolitan Region, pilot: Tarsun Enterprises), and the non-negotiable interface rules that follow from it.

Companion to `docs/02-five-apps-and-surfaces.md` (what each app is), `docs/06-order-to-cash-flows.md` (what each screen does), `docs/08-frontend-architecture.md` (how it is built). This file answers a different question: **what the body and the environment will physically permit.**

---

## 0. Method and evidence quality

- Every numeric rule below traces to either (a) a published standard, (b) a peer-reviewed or first-party study, (c) a 2026-current market statistic, or (d) the repo's own field research (`docs/research/R01`, `R09`, `docs/domain/operational-pain-points.md`), which was gathered from vendor sites and Google Play reviews on 2026-09-04.
- **Directional / weak sources are marked `[directional]`.** Vendor marketing numbers and single-blog statistics are used only to corroborate, never as the sole basis for a rule.
- Where a rule is a *design judgement* derived from evidence rather than a measured finding, it says so.
- Unit convention: Android `dp` and iOS `pt` are both ≈ **0.159 mm** at reference density (1 dp = 1/160 inch). All millimetre figures below convert at that rate, so **10 mm ≈ 63 dp, 11 mm ≈ 69 dp, 12 mm ≈ 76 dp**. A CSS pixel is 1/96 inch = 0.265 mm, so WCAG's 24 px is 6.35 mm and 44 px is 11.6 mm.

---

## 1. The physical envelope shared by all six users

These conditions apply to every app and are not negotiable by any screen.

### 1.1 Light

Direct sunlight delivers **80,000–200,000 lux**, roughly 300× a lit office ([Absen](https://www.absen.com/complete-guide-to-contrast-ratio/), [DisplayModule](https://www.displaymodule.com/blogs/knowledge/sunlight-readable-tft-displays-nits-brightness-contrast-anti-glare)). Ambient light adds a fixed luminance floor to *both* the black and white states of a screen, so the **ambient contrast ratio (ACR)** — not the spec-sheet contrast ratio — is what the eye actually gets. A conventional 300–400 nit panel under 80,000 lux falls **below 3:1 ACR, at which the eye cannot resolve edges at all**; the practical floor for reading text and graphics in direct sun is about **5:1 ACR**, which needs a panel at **1,000+ nits** ([DisplayModule](https://www.displaymodule.com/blogs/knowledge/sunlight-readable-tft-displays-nits-brightness-contrast-anti-glare), [Things Embedded](https://things-embedded.com/us/white-paper/key-features-for-choosing-a-sunlight-readable-display/)).

We do not control the hardware. Entry-level Indian Android panels are 450–600 nits typical. **We therefore have no headroom to spend on subtle greys.** The only variable left to design is the ratio between our foreground and background, and the proportion of the screen sitting at peak white.

Consequence that is easy to get wrong: **dark mode is worse outdoors, not better.** Ambient reflection adds the same absolute luminance to every pixel; a light UI puts most of the screen at the panel's maximum output and swamps that reflection, a dark UI does not. Dark mode is a comfort feature for the owner's desk at night, not a field feature.

### 1.2 Noise

Average road-traffic noise exceeds **70 dB(A) in most Indian cities**; Delhi market surveys recorded up to **100 dB in commercial zones** and **125 dB in the Kirti Nagar marble market** ([CSE](https://www.cseindia.org/cse-surveys-noise-pollution-in-delhi--3172), [Puducherry traffic-noise study, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10853037/)). The regulatory daytime limit for commercial areas is 65 dB and is routinely exceeded. Two-wheeler horns are legally permitted up to 105 dB, commercial-vehicle horns up to 125 dB.

**Sound is not an available feedback channel.** A phone speaker at arm's length in a Kalyan market street is inaudible. Every confirmation must be *visual + haptic*; audio is optional, off by default, and never the only signal.

### 1.3 Weather (Kalyan specifically)

Kalyan takes ~**1,586 mm of rain a year**; **July alone averages 487 mm across 21 rainy days**, with humidity peaking at **86% in July** and sitting near 80% through June–September. April highs reach **37 °C** ([weather-and-climate.com, Kalyan](https://weather-and-climate.com/average-monthly-Rainfall-Temperature-Sunshine,kalyan-maharashtra-in,India)).

So for **four months a year the operative assumption is a wet screen and a wet finger**, and for the rest of the year a sweaty one. Capacitive touchscreens cannot distinguish a fingertip from any other conductive object; water on the surface registers as touch, and droplets grounded through the device housing produce false touches, while a wet fingertip degrades measurement accuracy ([EE Times](https://www.eetimes.com/the-basics-of-waterproofing-capacitive-touchscreens/), [RainCheck, Univ. of Washington, ICMI '18](https://faculty.washington.edu/wobbrock/pubs/icmi-18.01.pdf)). Vendor water-rejection algorithms exist but are inconsistent across the entry-level Android tier we must support.

Design consequence: **gestures degrade first, taps degrade last.** Swipe, drag and long-press are the first things to break under water; a large discrete tap target is the most robust input we have.

### 1.4 The device floor (2026, and it got worse this year)

The performance floor moved *down* during 2026, not up:

- Smartphone **memory prices have risen nearly 4× since September 2025**, and budget phones launching in H2 2026 are expected to ship **4 GB RAM with slower storage at higher prices** ([Business Standard](https://www.business-standard.com/technology/tech-news/ai-driven-memory-inflation-pushes-india-s-budget-smartphones-out-of-reach-126051401165_1.html), [TechyUltra](https://techyultra.com/ram-shortage-in-2026/)).
- Sub-₹15,000 shipments **fell 45% YoY in the June 2026 quarter**; sub-₹10,000 is projected to fall to **12–13% of shipments in 2026** from ~18% in 2025 ([Business Standard](https://www.business-standard.com/technology/tech-news/premium-push-or-rising-costs-what-s-shrinking-india-s-budget-phone-market-126031300318_1.html)).
- **4G phones grew from 7% of sales in Q4 2025 to 12% in Q2 2026**, with a 4G ASP of **$109** against $341 for 5G ([Business Standard](https://www.business-standard.com/industry/news/4g-phones-gain-ground-in-india-as-memory-prices-nearly-quadruple-126090400462_1.html), [Counterpoint](https://counterpointresearch.com/en/insights/india-smartphone-share)).
- Android version share in India, **August 2026** (StatCounter, mobile): Android 16 24.11%, 15 23.28%, 13 13.85%, 14 12.14%, 12 9.41%, 11 8.81% — a **far flatter spread than the US**, i.e. a long tail of old devices ([StatCounter](https://gs.statcounter.com/android-version-market-share/mobile/india)).

The people who will actually hold our phone apps — a salesman on ₹12,000–18,000/month, a delivery rider on ₹11,000–16,000/month (`docs/research/R09` §2; [PMC rider study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12990256/)) — are precisely the users buying the 4 GB 4G handset. **The performance floor is a 4 GB RAM, 4G, Android 11–13 device with a 450–600 nit screen and a full storage partition.**

Performance is not polish here, it is retention. Google's own case study of **OkCredit** — an Indian shopkeeper ledger app with 50M+ downloads — reports that reducing ANRs by **60% on low-end devices** produced a **22% improvement in Day-1 retention on those devices**, a **70% faster cold start**, a **30% rise in average merchant transactions**, and a Play rating move from 4.3 to 4.6 ([Android Developers](https://developer.android.com/stories/apps/okcredit)). Google Play's own bad-behaviour thresholds are a **user-perceived ANR rate of 0.47% of daily active users** and a **user-perceived crash rate of 1.09%**, with a per-device threshold of 8%; exceeding them reduces store visibility ([Android vitals](https://developer.android.com/topic/performance/vitals/anr), [Android Developers Blog](https://android-developers.googleblog.com/2022/10/raising-bar-on-technical-quality-on-google-play.html)). An ANR fires after **5 seconds** of a blocked main thread.

Install size matters too: **~70% of people in emerging markets check app size before downloading**, every **6 MB of extra download size costs roughly 1% of install conversion**, and apps over 150 MB see installs fall around 30% ([Google Play / Sam Tolomei](https://medium.com/googleplaydev/shrinking-apks-growing-installs-5d3fcba23ce2)).

### 1.5 Connectivity and data cost

India's blended median mobile speed is high (~94 Mbps down, ~12 Mbps up, ~70 ms ping over Jul 2025–Jun 2026) but that number is dominated by 5G in metros; the users above are on 4G, indoors, inside concrete shophouses, in a godown with a tin roof. Tariffs are expected to rise **10–20% during 2026** ([Morgan Stanley / Axis Capital estimates, summarised](https://www.sakshipost.com/news/business/mobile-recharge-price-hike-jio-airtel-and-vi-likely-raise-tariffs-20-475729)).

`docs/research/R01` §5.1 records six straight years of the same top-voted complaint on the two Indian market leaders — Bizom and FieldAssist — that **sync is the product's failure point**: "sync after every outlet", "daily sync take too much time", "sync process is very slow", "after the update the app is working too slow". This is corroborated independently: reviewers report FieldAssist "extremely slow, hangs all the time", crashing during work, and heavy battery consumption ([SoftwareSuggest](https://www.softwaresuggest.com/fieldassist/reviews), [Capterra – Bizom](https://www.capterra.com/p/146321/Bizom/reviews/)).

### 1.6 English-only, and the risk it carries

The founder has fixed **English-only for now**. The 2011 Census records **~10.6% of Indians reporting any English at all** (0.02% L1, 6.57% L2, 3.6% L3) ([Multilingualism in India, summarising Census 2011](https://en.wikipedia.org/wiki/Multilingualism_in_India)). Urban Maharashtra is above the national figure, and a distributor's salesman and accountant will typically read Latin script and English numerals — but the loader, many riders, and a meaningful fraction of kirana owners will not read an English *sentence*.

This is survivable only if the interface is built so that **the numerals and the icons carry the meaning and the English words are confirmation, not instruction.** That is a design constraint, not an i18n task, and it must be honoured now even though translation comes later.

### 1.7 Rules — universal (apply to all six apps)

| # | Rule | Basis |
|---|---|---|
| U1 | **Light theme is the default and the only field theme.** Dark mode may exist for the owner/accountant desk surfaces; it is never the default on sales, warehouse, delivery or retailer, and is never auto-selected by system appearance on those apps. | §1.1 — ACR collapse under 80,000+ lux |
| U2 | **Minimum contrast 7:1 (WCAG AAA) for every piece of text, not 4.5:1.** Any number a decision is made on (money, quantity, outstanding, count) uses the near-maximum pair: `#111` on `#FFF` (≈ 18:1). No grey-on-grey secondary text below 7:1 anywhere in a field app. | §1.1; [WCAG 1.4.6](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) |
| U3 | **No information is carried by hue alone.** Every state is colour **+** icon **+** word (already law in `docs/08`); this rule additionally requires the icon and word to survive at 3:1 luminance contrast, because hue separation is the first thing lost in sun. | §1.1 |
| U4 | **Every committed action fires a haptic.** Success, warning and error use the OS semantic constants (`HapticFeedbackConstants` / Core Haptics notification types), never a raw vibration duration. Haptic is always paired with a visual change and never used alone. No haptic on scroll, hover or navigation. | §1.2; [Android haptics principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles) |
| U5 | **No sound is required to understand any state.** Sounds are off by default and are a preference, never a channel. | §1.2 — 70–100 dB ambient |
| U6 | **Minimum touch target 11 mm (≈ 69 dp) for anything tapped while standing, walking, wet or in a moving vehicle; 10 mm (≈ 63 dp) elsewhere; 12 mm (≈ 76 dp) on the warehouse floor.** Minimum gap between adjacent targets 3 mm (19 dp); minimum gap between a confirming action and a destructive/irreversible one 8 mm (50 dp). Note that Material's 48 dp is only **7.6 mm** and Apple's 44 pt only **≈ 7 mm** — platform minimums are *below* the standard for handheld use and are not sufficient here. | ISO/TS 9241-411:2012 (9 mm square / 11 mm circular for <4% error; 2–3 mm minimum spacing, 5–8 mm optimal) — [ISO sample](https://cdn.standards.iteh.ai/samples/54106/cf35f99b4eb94bfe871f4b71b524c2c0/ISO-TS-9241-411-2012.pdf); Hoober, *Touch Design for Mobile Interfaces*: 11 mm at screen top, 12 mm at bottom — [Smashing](https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/) |
| U7 | **No gesture is the only way to do anything.** Swipe, drag, long-press and pinch are accelerators; every one has a visible tap equivalent on the same screen. Nothing destructive is triggered by a gesture. | §1.3 — wet-finger false touch |
| U8 | **Minimum body text 16 sp; minimum 20 sp for any money or quantity figure; 24 sp+ for the one number the screen exists to show.** Never below 14 sp for any legible content, including captions and table cells. Tabular/lining numerals with fixed advance width for all money. | §1.1 + outdoor legibility practice; [field-service UI guidance](https://www.softwaretestingmagazine.com/knowledge/mobile-qa-improving-ux-for-field-service-technicians/) |
| U9 | **Every primary action sits in the bottom third of the screen.** The top of the screen carries information only. Hoober's observational study of 1,300+ users: **49% one-handed, 36% cradled, 15% two-handed; thumbs drive 75% of all interactions; 67% right-thumb.** On 6.4"+ devices, bottom-third placement is what preserves >92% one-handed reach. | [Smashing / Hoober](https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/); [A List Apart](https://alistapart.com/article/how-we-hold-our-gadgets/) |
| U10 | **Nothing destructive lives in the bottom bar or under the resting thumb.** Cancel, void, delete and "fail delivery" go behind a deliberate second action, placed away from the green zone. | U9 + §1.3 |
| U11 | **Performance budget, enforced in CI on a 4 GB reference device:** cold start to first interactive frame ≤ **2.0 s**; any user-initiated action acknowledged on screen within **100 ms** and complete or showing determinate progress within **1.0 s**; user-perceived ANR ≤ **0.2%** DAU and crash ≤ **0.5%** DAU (half of Play's 0.47% / 1.09% thresholds); zero blocking main-thread work over 200 ms. | §1.4; [Android vitals](https://developer.android.com/topic/performance/vitals/anr); [OkCredit case study](https://developer.android.com/stories/apps/okcredit) |
| U12 | **Download-size budget: ≤ 40 MB per app (Android App Bundle download size), ≤ 120 MB installed.** Retailer app additionally holds the existing ≤ 600 KB gzipped initial-route web budget (`docs/02`). | [Google Play size/conversion data](https://medium.com/googleplaydev/shrinking-apks-growing-installs-5d3fcba23ce2) |
| U13 | **Data budget: a full working day must cost under 10 MB.** A salesperson's 40–80-outlet beat day, a rider's 25-stop trip, or a warehouse day of GRNs must each fit in 10 MB of network traffic including images (images uploaded compressed, deferred, and resumable). | §1.5; tariff inflation |
| U14 | **Support Android 11 (API 30) and above, and iOS 16 and above.** Android 11+ covers ~92% of Indian Android page-view share as of Aug 2026. Verify every release on a 4 GB device before it ships. | [StatCounter India](https://gs.statcounter.com/android-version-market-share/mobile/india) |
| U15 | **The English rule: a user who reads no English sentence must still be able to complete every primary flow.** Numerals, ₹ amounts, quantities, icons, photographs, colour-and-shape state chips and the retailer's own shop name carry the flow; English words label and confirm. No flow may depend on reading a sentence, a paragraph, an empty-state explanation, or an error message. All strings live in one catalogue with a ≤ 20-character budget per label so a later Marathi/Hindi pass is a swap, not a rewrite. | §1.6 |
| U16 | **No modal ever blocks work for sync, GPS, permission or connectivity** (restates `docs/08`, and it is the single most-cited failure of the incumbents). Connection state is shown honestly and passively — a persistent, non-blocking status chip that says *what is pending and since when*, never a "Sync now" button. | `docs/research/R01` §5.1 |

---

## 2. The salesperson on the beat

### 2.1 What the day actually is

From `docs/research/R09` §2, corroborated by the trade press: a distributor salesman **walks 8–15 km a day and visits 30–50 outlets**; a fortnightly packaged-foods beat runs **40–80 outlets with 6–12 minute calls**, daily categories 80–150 outlets; vendor benchmarks put target coverage at **40–45 calls/day** ([FieldAssist](https://www.fieldassist.com/blog/6-fmcg-sales-metrics-to-track), [SpireStock beat planning](https://spirestock.com/beat-planning)). Pay is ₹12,000–18,000/month with **30–50% annual attrition** and a 15–25% sales dip for 2–3 months when a beat changes hands.

The physical posture is specific and it is the design brief: **standing in a shop doorway or in the 60 cm gap between the counter and the sacks, phone in one hand, the other hand holding a sample or a scheme sheet, the shopkeeper talking and simultaneously serving a customer, sunlight or a tube light behind the phone, traffic noise, six to twelve minutes total of which the app may claim maybe ninety seconds.** He is not seated. He does not put the phone down. He will not use two thumbs.

### 2.2 What kills adoption — the documented list

`docs/research/R01` §5 catalogues six years of top-voted Google Play complaints across Bizom, FieldAssist, Botree, BeatRoute and PepUpSales. The four that are specifically *interface* failures:

1. **Sync is the failure point.** "Sync after every outlet" (Bizom, 2022); "daily sync take too much time" (Bizom Next, Aug 2026); "sync process is very slow" (Botree distributors, May 2025). Independently corroborated: Bizom users report the app "works very slow whenever it communicates with backend server specially at EOD" ([Capterra](https://www.capterra.com/p/146321/Bizom/reviews/)); FieldAssist users report it is "extremely slow, hangs all the time" and crashes during work ([SoftwareSuggest](https://www.softwaresuggest.com/fieldassist/reviews)).
2. **Geo-fence false negatives block work.** Reps standing inside the shop are told they are 7 km away and cannot bill (Bizom Jun 2026; FieldAssist May 2024, Apr 2025, Aug 2026; BeatRoute Jul 2025).
3. **Battery drain and permission nagging.** Bizom (2020, 2025), FieldAssist (2021, "every day app want to open setting and permission", Dec 2025), Botree SFA (Jul 2026). Corroborated: reviewers ask that the app "use less data as users' mobile batteries drain" and "make the app lighter" ([Capterra](https://www.capterra.com/p/146321/Bizom/reviews/)).
4. **The session dies on a phone call.** Botree SFA "auto-logout during call" (Jul 2026); Bizom Next "once I receive phone calls I have to start… over again" (Aug 2026).

Point 4 deserves emphasis because it is *the* signature failure of this category: a salesman's phone is also his work phone. He takes a call from the manager mid-order. If the app loses the half-built order, he stops using the app and goes back to the notebook.

### 2.3 The commercial reality that shapes the screens

- **Doorstep price disputes are a daily event** — "salesman promised a scheme" (`operational-pain-points` #27). The scheme the retailer is told about must be the scheme the invoice prints. So the order screen must *show* the applied scheme per line, in rupees, at order time, at a size the shopkeeper can read across the counter.
- **Case-vs-piece confusion happens on every document** (#6). "2 case = 180 pcs" must be visible simultaneously, never toggled.
- **The salesman must never see purchase cost** (#21) — this is a database guarantee, but it is also a screen guarantee: the sales bundle must not contain cost UI at all.
- **Outstanding must be on the shop card**, because the rep is the collection channel of first resort (#4).

### 2.4 Rules — salesperson (S)

| # | Rule | Basis |
|---|---|---|
| S1 | **A repeat order is placeable in 3 taps from a cold app open**: open → shop (already first on the beat list) → "Reorder last order" → submit. A modified order — reorder plus quantity edits on ≤ 5 lines — completes in **≤ 15 taps and ≤ 60 seconds** on the reference device. Measure this in a Maestro flow and fail CI if it regresses. | §2.1: 6–12 min per call, app may claim ~90 s |
| S2 | **The whole order flow is operable with one right thumb without a grip change.** Beat list, shop card, quantity steppers, scheme chips and Submit all sit in the bottom two-thirds. Product search results are reachable by scroll, never by a top-anchored control. | U9; §2.1 posture |
| S3 | **Quantity is never a free text field.** A stepper with case/piece both visible ("2 case = 180 pcs"), plus a full-screen number pad for large edits. Stepper targets 11 mm minimum with 3 mm separation; the stepper defaults to the last ordered quantity. | `docs/08` zero-training rules; U6 |
| S4 | **The session survives a phone call, an app kill, a battery death and a day without signal.** Every keystroke of a draft order is persisted locally within 500 ms. Returning to the app restores the exact scroll position, the exact line being edited and the cursor. There is no "resume?" prompt — it simply is where it was. | §2.2 item 4 |
| S5 | **Geo-tag is evidence, never a gate.** Outside the fence is an amber chip with the distance, and the order proceeds. There is no screen on which a location reading can prevent a sale. | §2.2 item 2; `docs/06` |
| S6 | **No "Sync now" button and no sync modal.** A single persistent chip states plainly what is queued and how old the data is (e.g. "3 orders waiting · stock as of 9:40 am"). Tapping it opens a list, never a blocking action. | §2.2 item 1; U16 |
| S7 | **Permissions are asked once, in context, at the moment of first genuine need, with a plain sentence about why — and never again in that session.** No permission is re-requested on app open. A denied permission degrades the feature, never the app. | §2.2 item 3 |
| S8 | **The applied scheme is printed on the order line in rupees, at ≥ 16 sp, and the order-confirmation view is legible held at arm's length across a counter** (all figures ≥ 20 sp, single column, no horizontal scroll). | `operational-pain-points` #27 |
| S9 | **The sales bundle contains no cost UI, no margin UI and no purchase-price string** — verified by the existing CI role-leak dump extended to the app bundle. | `operational-pain-points` #21 |
| S10 | **Every shop card opens with outstanding, ageing bucket and last order visible above the fold** without a tap. | `operational-pain-points` #4; `docs/06` |
| S11 | **Background location is trip/beat-scoped and disclosed.** No all-day polling. A visible, dismissible statement of what is being recorded and for whom. | §2.2 item 3; `docs/08` GPS decisions |
| S12 | **Beat knowledge belongs to the screen, not the rep.** Every shop card carries last-order context, outlet class and visit history so an inheriting rep is not blind. | `operational-pain-points` #13 (attrition 30–50%/yr) |

---

## 3. The warehouse floor

### 3.1 What the floor actually is

A godown in Kalyan: concrete floor, corrugated roof, no air conditioning, 37 °C in April and 86% humidity in July. Cartons stacked to head height. Cardboard dust and packing-strap debris. A loader's hands are dusty, sweaty and often sticky from tape. The invoice arrives **on paper, frequently torn, folded, oil-marked or thermal-faded**, sometimes still in the transporter's hands. Counting happens out loud, in Marathi or Hindi, by two people — one calling the number, one writing.

The phone lives in a trouser pocket or on top of a carton. It gets picked up, used for eight seconds, and put down. It is not held continuously.

The specific product reality (`docs/05`, `docs/plans/warehouse.md`, `operational-pain-points`):

- The **blind gate count** is the only typing allowed in the inbound pipeline. That single number is load-bearing for the whole "zero manual entry" claim.
- **Case-vs-piece and "x 90" / "_120" / CS1 suffixes** are parsed from the invoice and must be *confirmed* by a human who is standing in front of the actual carton (#6).
- **Transit damage must be annotated on the LR at unloading or the claim is dead** (#18) — that is a photo taken with dirty hands, in a hurry, while a truck driver waits.
- **Multiple MRPs of the same SKU** coexist in stock (#29); the picker must be told which lot.

### 3.2 The scanning ergonomics problem

Capacitive touchscreens do not work through standard gloves; response degrades with thick insulation, poor fingertip fit and moisture ([NM Safety](https://www.nmsafety.com/touchscreen-winter-gloves/), [LIDD](https://lidd.com/handheld-device/)). Indian godown loaders generally work bare-handed, which removes the glove problem but replaces it with dust, sweat and tape adhesive — all of which degrade capacitive accuracy in the same direction.

Camera-based barcode scanning (our `expo-camera` + ML Kit choice) fails predictably on: glossy shrink-wrap under a tube light, crushed or torn cartons, faded thermal labels, and codes on the underside of a stacked case. **A manual code-entry path is not a fallback; it is a co-equal primary input.**

### 3.3 Rules — warehouse (W)

| # | Rule | Basis |
|---|---|---|
| W1 | **Minimum touch target 12 mm (≈ 76 dp) on every warehouse screen**, with 4 mm (25 mm-free) separation. This is the ISO 9241-411 upper mobile band and Hoober's 12 mm bottom-of-screen figure, chosen because the hand is dirty, damp and hurried. | ISO/TS 9241-411; §3.1 |
| W2 | **The gate count is entered on a full-screen number pad with digits ≥ 44 sp, an unmistakable running total, and no other control on screen.** No spinner, no keyboard, no adjacent fields. | `docs/05`; U6 |
| W3 | **Every scan screen has an equally prominent "Type code" button at the same size in the same thumb zone** — never hidden behind a menu or an error state. | §3.2 |
| W4 | **The phone can be put down and picked up at any point without losing a single entry.** Every count, every line confirmation and every photo persists on the instant it is made. There is no "Save" step that can be lost. | §3.1 posture |
| W5 | **Case and piece are always shown together and are never a toggle.** Every quantity on every warehouse screen reads as both ("14 cs + 6 pc = 1,266 pc"). | `operational-pain-points` #6 |
| W6 | **Photo capture is one tap from the screen that needs it, tolerates a shaking hand, and never blocks on upload.** Photos queue and upload in the background; the flow continues immediately. Damage annotation on the LR is a mandatory step in the unload flow, not an optional field. | `operational-pain-points` #18; U13 |
| W7 | **The review screen shows the invoice crop beside the extracted value, one field at a time, with Accept / Fix at 12 mm.** The reviewer never scrolls a table sideways and never types a value that was extracted correctly. | `docs/05`; `docs/08` `RowCrop` primitive |
| W8 | **The picklist tells the picker the exact lot: batch, MRP and expiry, with the FEFO warning as colour + icon + word.** MRP is displayed at ≥ 20 sp because it is the number that determines whether the right carton was taken. | `operational-pain-points` #29, #9 |
| W9 | **No warehouse flow requires a sustained two-hand grip.** A tablet on a shelf and a phone in one hand must both work; layouts are single-column at phone width and never require pinch-zoom. | §3.1 |
| W10 | **Torch toggle is available on every camera screen** and its state persists for the session. Godown lighting is a tube light 4 m up. | §3.1 |

---

## 4. The delivery rider

### 4.1 What the trip actually is

The qualitative evidence is direct. A 2026 phenomenological study of urban Indian delivery riders (n = 10, 60–90 minute interviews, Tamil Nadu) records **8–13 hour working days at ₹11,000–16,000/month without contracts or insurance**; riding in rain despite "colds and fevers"; "wearing a helmet all day gives me neck pain — if I don't wear it, my eyes hurt"; "headaches from the heat"; and chronic shoulder and knee injury from the riding posture ([PMC 12990256](https://pmc.ncbi.nlm.nih.gov/articles/PMC12990256/)). Fairwork India's assessments have found **no platform scoring above six out of ten** on labour standards ([Fairwork](https://fair.work/en/fw/fairwork-reports/)).

Our rider is not a gig worker — he is on the distributor's payroll, two per vehicle, multiple trips a day (`docs/research/R09` §3) — but the *body* is the same body: helmet on, gloves sometimes, one hand on the handlebar or holding a carton, rain in the monsoon, engine and horn noise, and a shopkeeper standing over him disputing a quantity while a customer waits.

**He is also carrying cash.** Trip settlement, expected-vs-collected, and cash leakage are the owner's second cash problem (`operational-pain-points` #10, #11). The rider's hands are physically occupied by money at exactly the moment the app needs input.

**Legal constraint:** using a mobile phone while driving is prosecuted under **Section 184 of the Motor Vehicles Act (as amended 2019)** as dangerous driving — **₹1,000 for a first offence, ₹2,000 subsequently**, with imprisonment possible for repeat offenders ([GoDigit](https://www.godigit.com/transport/motor-act/section-184-motor-vehicle-act), [InsuranceDekho](https://www.insurancedekho.com/car-insurance/news/fne-for-using-phone-while-driving-in-india.htm)). The app must never require interaction while the vehicle is moving, and must never create an incentive to glance at it.

### 4.2 Rules — delivery (D)

| # | Rule | Basis |
|---|---|---|
| D1 | **Nothing in the app requires interaction while the vehicle is in motion.** Next-stop information arrives as a notification with the address and shop name legible from the notification shade alone; navigation hands off to Google Maps and does not return-trip through our UI. No timer, no countdown, no "tap to acknowledge" that rewards riding one-handed. | MV Act §184; §4.1 |
| D2 | **The entire stop flow is one-thumb operable with the phone in one hand.** Deliver / Partial / Fail are three buttons of ≥ 11 mm in the bottom third, separated by ≥ 8 mm because one of them is destructive. | U6, U9, U10 |
| D3 | **A clean delivery completes in ≤ 3 taps: Deliver → photo → Confirm.** Collection adds at most 2 more (Cash / UPI → amount confirm). Total ≤ 5 taps for the common case. | §4.1 — hands full of cash and cartons |
| D4 | **Photo POD never blocks.** The photo is captured, the stop closes immediately, the upload is queued and resumable. A failed upload is a background retry, never a red screen at the next stop. | U13; `operational-pain-points` #12 |
| D5 | **The disputed-quantity screen is designed to be turned around and shown to the shopkeeper**: line, ordered qty, delivered qty, difference in ₹, all ≥ 20 sp, single column, no scroll for a typical 6-line order. This is the artefact that ends the argument. | `operational-pain-points` #12, #27 |
| D6 | **Cash amounts are entered on a number pad with denomination-free large digits, and the expected amount is displayed above the input, never pre-filled into it.** Pre-filling is what produces false settlements. | `operational-pain-points` #11 |
| D7 | **All state survives a dead battery mid-trip.** Every stop outcome and every receipt is durable at the instant of the tap. A rider who charges his phone at a shop and returns finds the trip exactly as he left it. | §4.1 — 8–13 hour days |
| D8 | **Trip-scoped GPS with a permanent, honest foreground notification** naming the distributor ("Trip in progress — location shared with Tarsun Enterprises"), and location stops the moment the trip closes. | `docs/06`; §2.2 item 3 |
| D9 | **Wet-condition operation: no swipe-to-complete, no drag-to-reorder-stops, no slide-to-confirm anywhere in the delivery app.** Discrete taps only. | §1.3 |
| D10 | **The retailer's phone number is a one-tap call from the stop screen until the stop is closed**, because half of delivery failure is "shop shut, ring the owner". | `docs/06` |

---

## 5. The retailer (kirana shopkeeper)

### 5.1 Who he is and what his attention is worth

A ₹2–4 lakh/month kirana. He is standing behind a counter, serving a customer every 40 seconds, weighing something, making change, and talking to two people at once. His patience for an app is measured in **seconds, and his tolerance for a registration form is zero**.

The evidence on why apps fail with this user is unusually consistent:

- **He is already on WhatsApp and he is not on your app.** India is WhatsApp's largest market at **500M+ monthly users** (Meta's own figure) and **78% of Indian SMBs use WhatsApp for business**, with ~15 million active WhatsApp Business accounts ([Tata Communications](https://www.tatacommunications.com/knowledge-base/cpaas/whatsapp-statistics), [WizMessage](https://wizmessage.com/blog/whatsapp-business-statistics)). One widely-circulated figure puts kirana retail-app adoption at **~12% against 97% daily WhatsApp usage** — `[directional]`, blog-sourced, but directionally consistent with everything else ([Policy Circle](https://www.policycircle.org/opinion/kirana-stores-online-retail/)).
- **Registration is where he leaves. 43% of users abandon onboarding at identity/phone verification**, up to **35% drop off after install without completing sign-up**, and users who hit friction in the first session are **2.7× less likely to return by Day 7** — a pattern explicitly noted as worse in India because of mid-range devices and variable connectivity ([IPification](https://www.ipification.com/blog/how-mobile-apps-can-cut-the-drop-off-rate-in-sign-in-process/), [productgrowth.in](https://productgrowth.in/insights/consumer/onboarding-dropoffs-bharat/)).
- **The kiranatech graveyard is real.** OkShop (Apr 2022) and MyStore (Nov 2021) — the storefront products of the two biggest Indian shopkeeper apps — were both shut. The ledger survived; the added surface did not ([The Ken](https://the-ken.com/story/why-khatabook-okcredits-kiranatech-failed-to-fly-off-the-shelves/), paywalled headline). The lesson is that the shopkeeper adopts exactly one job-to-be-done and abandons everything bolted onto it.
- **He is suspicious for good reasons.** Documented distributor-side complaints include stock shown ≠ stock available producing cancelled orders (Shikhar 2019–2022, Coke Buddy 2023–2025), "delivered" status without delivery, and the scheme shown in the app not being honoured on the bill (`docs/research/R01` §5.8, §5.9). If our app does any of those once, it is uninstalled.
- **UPI is not a feature to him, it is how money moves.** 23.2 billion UPI transactions in May 2026; 678 million QR codes deployed; P2M is 60–65% of volume ([coinlaw](https://coinlaw.io/upi-statistics/), [TechRT](https://techrt.com/upi-statistics/)) `[directional on the sub-figures]`.

### 5.2 What he actually cares about, in order

From `docs/01` and `operational-pain-points`: (1) what do I owe and against which bill, (2) did the delivery come right, (3) what is the price and the scheme, (4) when will it come. Nothing else.

### 5.3 Rules — retailer (R)

| # | Rule | Basis |
|---|---|---|
| R1 | **The retailer never fills a registration form.** He arrives from a WhatsApp deep link already identified. The first screen is his outstanding or his last order — never a signup, never a tour, never a permission prompt. Account creation, if it ever happens, happens *after* he has already got value. | §5.1 — 43% abandon at verification |
| R2 | **First meaningful paint ≤ 2.5 s on a 4 GB device over 4G, from a cold WhatsApp link tap.** Initial route ≤ 600 KB gzipped (existing `docs/02` budget). | U11, U12; 2.7× D7 penalty for first-session friction |
| R3 | **A reorder is 2 taps from the WhatsApp link**: link → "Order again" → Confirm. Any change to that order is a stepper, never a form. | §5.1 — seconds of attention |
| R4 | **Availability shown is availability reserved.** Quantities offered come from `sellable_stock`; we never show a number we cannot fulfil. This is the single most-cited reason retailers abandon brand apps. | `docs/research/R01` §5.8 |
| R5 | **The price and scheme he sees at order time is the price and scheme the invoice prints** — same engine, same `applied_rules`, shown to him in rupees before he confirms. | `docs/research/R01` §5.9; `operational-pain-points` #27 |
| R6 | **Delivery status is only ever set by the delivery app at the stop, with proof.** No status may advance from a back-office action. | `docs/research/R01` §5.9 |
| R7 | **The outstanding screen is shaped like his physical pending-bills file**: one row per bill, oldest first, ageing bucket as colour + icon + word, ₹ figures at ≥ 24 sp, UPI QR one tap away on every bill. | `docs/01` conversion thesis; §5.2 |
| R8 | **No push-notification permission on first open. No location permission, ever. No contacts permission, ever.** | §5.1 — aggressive permission requests drive abandonment |
| R9 | **Every important outcome also arrives on WhatsApp**, because that is the channel he actually reads. The app is the detail view for a WhatsApp message, not a destination he is expected to remember to open. | §5.1 — 500M+ users, ~98% open rates `[directional]` |
| R10 | **Nothing in the retailer app requires reading an English sentence.** Bill number, date, ₹ amount, shop name, product name, a QR, and three state chips are the entire vocabulary. | U15 |
| R11 | **One card per linked distributor, never a merged view** — a shop linked to three distributors must never see a blended catalogue or a blended balance. | `docs/02`; multi-distributor requirement in `CLAUDE.md` |

---

## 6. The owner at the desk (and on his phone)

### 6.1 Two different bodies, two different surfaces

The owner is the only user who exists in two postures, and `docs/02` already splits them correctly: **approvals and day-numbers on the phone, configuration and registers on a PC with the CA.** The mistake to avoid is designing the phone surface as a shrunken console.

On the phone he is: in the godown, in a car, at a brand meeting, at 9 pm at home. He wants four things — collected today, cash in transit, outstanding by age, and what needs his approval — and he wants them without a tap. `operational-pain-points` #30: "Owner has no live view; learns at month end."

At the desk he is: seated, keyboard, often with a printout, frequently with the CA beside him.

### 6.2 The Tally habit is a real interaction model, not nostalgia

Indian accounting practice is keyboard-first because Tally made it so. `Alt+G` opens a go-to for any report or voucher; `Tab` walks fields; `Ctrl+N` opens an in-app calculator; consistent shortcut use is credited with reducing per-transaction time by tens of seconds across hundreds of weekly entries ([Suvit](https://www.suvit.io/post/40-tips-for-tally), [NovaTechnoSys](https://www.novatechnosys.com/blogs/tally-prime-6-keyboard-shortcuts-productivity-hacks)). A distributor's accountant will judge our billing desk against that standard within ten minutes. `[directional on the "40 seconds" figure — vendor blog]`

He also **prints.** `docs/research/R02` §7 records that the Marg-shaped A4 bill prints from a PC in every office; `docs/research/R09` §7 lists the mandatory header fields. Printing is not a legacy affordance to be de-emphasised — it is the deliverable.

### 6.3 The deadline reality

GST filing is a monthly rhythm with hard edges, and the edges got harder:

- **GSTR-1 by the 11th, GSTR-3B by the 20th** for monthly filers.
- **Auto-populated liability in GSTR-3B was hard-locked from the July 2025 period**, and from the **November 2025 period Table 3.2 became non-editable** — corrections must now be made in **GSTR-1A *before* filing 3B** ([TaxClear](https://taxclear.in/gst-updates-july-2026-gstr-3b-auto-population-hard-locking-3-year-return-bar-itc-matching-and-penalties/), [ClearTax](https://cleartax.in/s/gstr-3b)).
- **From 1 January 2026, returns more than three years past due cannot be filed at all** — the period is permanently barred.

This changes the shape of the accountant's month: **the real deadline is the 11th, not the 20th**, because after GSTR-1 is filed the numbers are locked. Our registers must be reconciled and exportable *before* the 11th.

### 6.4 Rules — owner and accountant (O)

| # | Rule | Basis |
|---|---|---|
| O1 | **The owner's phone home screen answers four questions with zero taps**: collected today, cash in transit, outstanding by ageing bucket, and the count of things awaiting his approval. Rupee outcomes first, at ≥ 28 sp; percentages and counts secondary. | `operational-pain-points` #30; `docs/06` |
| O2 | **Every approval is decidable from the notification and the card without navigating away** — the card carries the amount, the who, the why, and the two buttons. | `docs/06` |
| O3 | **Every desk screen is fully operable from the keyboard.** `/` opens a global go-to (the `Alt+G` analogue); `Tab`/`Shift+Tab` walk fields in document order; `Enter` commits the primary action; `Esc` cancels; every list supports arrow-key navigation and `Enter` to open. No action anywhere in the console requires a pointer. | §6.2 |
| O4 | **Every shortcut is discoverable in place** — a `?` overlay listing them, and the shortcut printed on the button itself. Tally users expect to learn shortcuts by seeing them, not by reading documentation. | §6.2 |
| O5 | **Numeric entry on the desk never re-orders itself under the cursor.** Amounts are right-aligned tabular figures; typing never triggers a re-sort, re-filter or focus jump. | §6.2 — the classic web-app failure against Tally |
| O6 | **Every register prints to A4 and exports (Excel / Tally XML / CSV) from the same screen, with the export controls visible without scrolling.** "Distributors cannot get their own data out" is a top-7 documented complaint about the incumbents and is a selling point here. | `docs/research/R01` §5.7; `docs/01` conversion thesis |
| O7 | **Every GST screen shows days-to-deadline against the 11th (GSTR-1) as the primary date and the 20th (GSTR-3B) as secondary**, and refuses to present 3B figures as editable where the law has locked them. | §6.3 |
| O8 | **Density is a feature at the desk.** Table rows may go to 32 px with 14 px text on the console — but every desk table must fit an entire month of a typical retailer's bills without horizontal scrolling at 1366×768, which is the resolution that is actually on a distributor's office PC. `[design judgement, corroborated by R02 §7's Marg-shaped print reality]` | §6.1 |
| O9 | **The desk surfaces may offer dark mode; the phone owner surface follows U1 and defaults light**, because the owner reads it in the godown as often as at his desk. | U1 |
| O10 | **The profit / cost view is a separate, owner-only route that is never bundled into any other role's app.** | `operational-pain-points` #21 |

---

## 7. The manager and accountant (back office, :3002)

The manager is a hybrid: he is at the desk for the billing run and on the godown floor for the gate count. `docs/02` already places the billing desk on the web and the capture/GRN flow on the phone; that split is correct and this document reinforces it with one addition.

**The bulk-billing run is the single highest-repetition interaction in the entire product.** A distributor with 150 retailers issues 60–120 invoices a day. At the desk, that is a keyboard task governed entirely by O3–O5. On the phone it is a *review* task and must never become a data-entry task.

### 7.1 Rules — manager / accountant (M)

| # | Rule | Basis |
|---|---|---|
| M1 | **The billing desk is a keyboard loop**: select → review → issue → next, with the hand never leaving the keyboard, and a visible count of what remains in the run. | §7; O3 |
| M2 | **The manager's phone surfaces are confirm-and-photograph only.** Any flow that requires typing more than one number on a phone belongs on the desk. | §3.1; `docs/02` |
| M3 | **PDF rendering is server-side so the phone and the desk print byte-identically** (restates `docs/06`) — a rule with a UX consequence: the preview on the phone *is* the document, so it must be pinch-zoomable and legible, not a summary. | `docs/06` |
| M4 | **Ageing, credit-limit block and the reason for a block are stated in one line at the point of billing**, never discovered after the invoice is issued. | `operational-pain-points` #4 |

---

## 8. The consolidated non-negotiable list

Everything above, reduced to the rules a reviewer can check a screen against. The full statement of each is in its section.

**Physical**
1. Light theme in the field; dark mode never the field default. (U1)
2. 7:1 contrast for all text; ~18:1 for decision numbers. (U2)
3. Colour + icon + word for every state. (U3)
4. 11 mm touch targets in the field, 12 mm in the godown, 10 mm minimum anywhere; 3 mm gaps, 8 mm before anything destructive. Material's 48 dp (7.6 mm) is not enough. (U6)
5. Taps only for anything critical; no gesture-only path. (U7)
6. 16 sp body / 20 sp money / 24 sp+ for the number the screen is about. (U8)
7. Primary actions in the bottom third; nothing destructive under the resting thumb. (U9, U10)
8. Haptic on every commit, visual always paired, audio never required. (U4, U5)

**Performance and cost**
9. 2.0 s cold start, 100 ms acknowledgement, ANR ≤ 0.2% DAU on a 4 GB reference device. (U11)
10. ≤ 40 MB download, ≤ 120 MB installed. (U12)
11. ≤ 10 MB of data for a full working day. (U13)
12. Android 11+ / iOS 16+; every release verified on a 4 GB device. (U14)

**Flow**
13. Repeat order in 3 taps, modified order in ≤ 15 taps / ≤ 60 s. (S1)
14. Clean delivery in ≤ 3 taps, with collection ≤ 5. (D3)
15. Retailer reorder in 2 taps from a WhatsApp link, first paint ≤ 2.5 s. (R2, R3)
16. Retailer never sees a registration form. (R1)
17. Every desk flow fully keyboard-operable, with shortcuts shown in place. (O3, O4)

**Honesty**
18. No blocking modal for sync, GPS, permission or connectivity; connection state always visible and always passive. (U16, S6)
19. Geo-tag is evidence, never a gate. (S5)
20. State survives a phone call, an app kill, a dead battery and a day without signal. (S4, D7, W4)
21. Availability shown is availability reserved; price shown is price billed; status is set only by the person at the stop. (R4, R5, R6)
22. Numerals and icons carry every primary flow; English words label and confirm. (U15)

---

## 9. What I could not verify

- **The 12% / 97% kirana app-vs-WhatsApp figure** appears in secondary commentary without a traceable primary study. Treated as directional only; the rules it supports (R1, R9) are independently supported by the onboarding-abandonment data.
- **Google Play review pages could not be fetched directly** (404/JS-shell responses through the fetch tool). The verbatim Play complaints quoted in §2.2 come from `docs/research/R01`, which gathered them by browser on 2026-09-04; I corroborated the *pattern* independently through Capterra and SoftwareSuggest, but I did not re-verify individual quotes.
- **No published measurement of Indian entry-level phone peak brightness by model tier** was found; the 450–600 nit figure in §1.4 is inferred from the segment and should be replaced with a measured value from Tarsun's actual staff handsets before the pilot.
- **No study of glove use in Indian FMCG godowns** exists; §3.2 reasons from the general capacitive-glove literature plus the observed bare-handed norm. Worth one hour of observation at Tarsun to confirm.
- **The Ken's kiranatech post-mortem is paywalled**; only its headline claim and the two confirmed shutdown dates (OkShop Apr 2022, MyStore Nov 2021) are used.
- **A precise per-call time budget** (the 90-second figure behind S1) is derived from the 6–12 minute call length in `R09` §2, not measured. Time one of Tarsun's reps on a real beat before freezing S1's numbers.

---

## 10. Sources

**Standards and design research**
- ISO/TS 9241-411:2012 — touch target sizing and spacing: https://cdn.standards.iteh.ai/samples/54106/cf35f99b4eb94bfe871f4b71b524c2c0/ISO-TS-9241-411-2012.pdf
- Smashing Magazine — Accessible target sizes cheatsheet (Hoober's 11/12 mm figures): https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/
- Smashing Magazine — The Thumb Zone (Hoober's 1,300-user observation): https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/
- A List Apart — How We Hold Our Gadgets (Hoober): https://alistapart.com/article/how-we-hold-our-gadgets/
- NN/g — Touch targets on touchscreens: https://www.nngroup.com/articles/touch-target-size/
- W3C WCAG 2.2 — 2.5.5 / 2.5.8 target size, 1.4.6 contrast (enhanced): https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html
- Android — Haptics design principles: https://developer.android.com/develop/ui/views/haptics/haptics-principles

**Display and environment**
- DisplayModule — sunlight-readable displays, nits and ambient contrast: https://www.displaymodule.com/blogs/knowledge/sunlight-readable-tft-displays-nits-brightness-contrast-anti-glare
- Absen — contrast ratio guide (illuminance figures): https://www.absen.com/complete-guide-to-contrast-ratio/
- Things Embedded — choosing a sunlight-readable display: https://things-embedded.com/us/white-paper/key-features-for-choosing-a-sunlight-readable-display/
- EE Times — waterproofing capacitive touchscreens: https://www.eetimes.com/the-basics-of-waterproofing-capacitive-touchscreens/
- Wobbrock et al., ICMI '18 — RainCheck: overcoming capacitive interference caused by rainwater: https://faculty.washington.edu/wobbrock/pubs/icmi-18.01.pdf
- CSE — noise pollution survey, Delhi: https://www.cseindia.org/cse-surveys-noise-pollution-in-delhi--3172
- Traffic noise assessment, urban Puducherry (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC10853037/
- Kalyan climate averages: https://weather-and-climate.com/average-monthly-Rainfall-Temperature-Sunshine,kalyan-maharashtra-in,India

**Devices, performance, market**
- Counterpoint — India smartphone share: https://counterpointresearch.com/en/insights/india-smartphone-share
- Business Standard — 4G phones gain ground as memory prices quadruple (Sep 2026): https://www.business-standard.com/industry/news/4g-phones-gain-ground-in-india-as-memory-prices-nearly-quadruple-126090400462_1.html
- Business Standard — memory inflation pushes budget smartphones out of reach: https://www.business-standard.com/technology/tech-news/ai-driven-memory-inflation-pushes-india-s-budget-smartphones-out-of-reach-126051401165_1.html
- StatCounter — Android version market share, India: https://gs.statcounter.com/android-version-market-share/mobile/india
- Android vitals — ANR and crash bad-behaviour thresholds: https://developer.android.com/topic/performance/vitals/anr
- Android Developers Blog — raising the bar on technical quality on Google Play: https://android-developers.googleblog.com/2022/10/raising-bar-on-technical-quality-on-google-play.html
- Android Developers — OkCredit ANR case study (60% ANR reduction, +22% D1 retention, +30% transactions): https://developer.android.com/stories/apps/okcredit
- Google Play / Sam Tolomei — APK size vs install conversion: https://medium.com/googleplaydev/shrinking-apks-growing-installs-5d3fcba23ce2

**Field-app failure evidence**
- `docs/research/R01-india-dms-sfa.md` §5 (Play Store complaint corpus, 2020–2026)
- Capterra — Bizom reviews: https://www.capterra.com/p/146321/Bizom/reviews/
- SoftwareSuggest — FieldAssist reviews: https://www.softwaresuggest.com/fieldassist/reviews
- Software Testing Magazine — mobile UX for field service technicians: https://www.softwaretestingmagazine.com/knowledge/mobile-qa-improving-ux-for-field-service-technicians/

**Users and behaviour**
- Invisible burdens of platform work: qualitative study of food-delivery riders in urban India (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC12990256/
- Fairwork reports: https://fair.work/en/fw/fairwork-reports/
- Section 184, Motor Vehicles Act (phone use while driving): https://www.godigit.com/transport/motor-act/section-184-motor-vehicle-act
- IPification — sign-in drop-off (43% at identity verification): https://www.ipification.com/blog/how-mobile-apps-can-cut-the-drop-off-rate-in-sign-in-process/
- productgrowth.in — onboarding drop-offs in Bharat (2.7× D7 penalty): https://productgrowth.in/insights/consumer/onboarding-dropoffs-bharat/
- Policy Circle — kirana stores and digital retail tools: https://www.policycircle.org/opinion/kirana-stores-online-retail/
- The Ken — why Khatabook and OkCredit's kiranatech failed (headline + shutdown dates): https://the-ken.com/story/why-khatabook-okcredits-kiranatech-failed-to-fly-off-the-shelves/
- Tata Communications — WhatsApp statistics 2026: https://www.tatacommunications.com/knowledge-base/cpaas/whatsapp-statistics
- WizMessage — WhatsApp Business statistics 2026 (India SMB adoption): https://wizmessage.com/blog/whatsapp-business-statistics
- Multilingualism in India (Census 2011 English figures): https://en.wikipedia.org/wiki/Multilingualism_in_India

**Domain and compliance**
- FieldAssist — FMCG sales metrics (calls per day): https://www.fieldassist.com/blog/6-fmcg-sales-metrics-to-track
- SpireStock — beat planning and PJP: https://spirestock.com/beat-planning
- ClearTax — GSTR-3B due dates and rules: https://cleartax.in/s/gstr-3b
- TaxClear — GSTR-3B hard locking, 3-year bar: https://taxclear.in/gst-updates-july-2026-gstr-3b-auto-population-hard-locking-3-year-return-bar-itc-matching-and-penalties/
- Suvit — TallyPrime shortcuts: https://www.suvit.io/post/40-tips-for-tally
- NovaTechnoSys — TallyPrime 6 keyboard shortcuts: https://www.novatechnosys.com/blogs/tally-prime-6-keyboard-shortcuts-productivity-hacks
- Internal: `docs/domain/operational-pain-points.md`, `docs/research/R09-domain-operations.md`, `docs/02-five-apps-and-surfaces.md`, `docs/06-order-to-cash-flows.md`, `docs/08-frontend-architecture.md`, `docs/01-positioning-and-standout-features.md`
