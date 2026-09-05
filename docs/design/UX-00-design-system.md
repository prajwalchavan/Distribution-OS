# UX-00 — The Distribution OS design system

**Status:** proposal for the founder to approve. Once approved this is the contract every screen in all six apps is built against, and a screen is not "stable" until it passes it.
**Date:** 2026-09-04. **Supersedes** the styling and i18n rows of `docs/08-frontend-architecture.md`, and the placeholder palette in `frontend/libs/ui/src/tokens.ts`.
**Built on:** `docs/design/UX-01-field-reality.md` (what the body and the environment permit), `UX-02-current-standards.md` (what 2026 looks like), `UX-03-technical-constraints.md` (what the stack allows). Where this document and those disagree, this one wins — they are inputs, this is the decision.

Nothing here is optional and nothing here is a menu. Every number is a number, every colour is a hex, every rule is checkable in review. Where a rule comes from evidence, the source is cited inline as `[UX-01 U6]`, `[UX-02 R21]`, `[UX-03 D5]` or a live URL.

---

## 1. The idea in one paragraph

**These apps should feel like a well-kept ledger that answers instantly.** Money, stock and trust move through these screens: a salesman promises a scheme and the invoice has to print it; a rider types a cash figure that becomes the owner's expected deposit; a warehouse hand posts a GRN that becomes purchase cost forever. A wrong tap here is not a bad user experience, it is a real distributor losing real rupees and an argument at a counter tomorrow morning. So the product's whole personality is **certainty**: one number per screen, at a size you cannot misread, in ink-on-paper contrast that survives Kalyan sunlight; the state of everything stated in a word, not implied by a colour; nothing important hidden behind a gesture; and every commit acknowledged in under 100 ms with a visible change and a haptic you can feel through a pocket. It should be quiet, dense, fast, and slightly boring in the way a good instrument is boring. **It must never feel like** enterprise software from 2014 (navy sidebar, breadcrumb, grey-on-grey tables), never like a consumer fintech app (pastel gradients, celebratory confetti, a bouncing invoice), never like a web page wrapped in a phone, and above all never like the incumbents it replaces — which is to say it must never make a person wait on a sync, block them behind a modal, lose their half-typed order to a phone call, or tell them they are 7 km away when they are standing inside the shop.

---

## 2. Two surfaces, one system

There are **two densities, not two design systems**. Every token in §3–§5 is identical on both. What changes is the density of the grid, the navigation model, and the primary input device.

| | **Desk surfaces** — owner (:3001), manager + accountant (:3002) | **Field surfaces** — sales (:3003), warehouse (:3004), delivery (:3005), retailer (:3006) |
| --- | --- | --- |
| Primary device | PC, 1366×768 is the resolution actually on a distributor's office desk `[UX-01 O8]` | 4 GB / 720p / 4G Android, 5.5–6.6" `[UX-01 §1.4]` |
| Primary input | **Keyboard.** No action requires a pointer `[UX-01 O3]` | **One right thumb.** No action requires two hands `[UX-01 S2]` |
| Density | `desk` scale: 32 px table rows, 14 px cells, 12 px gutters | `field` scale: 56–76 dp rows, 16 sp body, 16 px gutters |
| Theme | Light default, **dark mode available** | **Light only.** Dark never auto-selected from system appearance `[UX-01 U1]` |
| Touch floor | 24×24 CSS px (WCAG 2.2 SC 2.5.8) — it is a mouse | **69 dp (11 mm)**, 76 dp (12 mm) in the godown `[UX-01 U6]` |
| Primary action | Top-right of the page header, plus `Enter` | **Bottom third of the screen**, above the safe-area inset `[UX-01 U9]` |
| Tables | Real `<table>` — selection, right-click, `Cmd+P`, sticky header, frozen first column | Cards or priority lists. **Never a table** `[UX-02 R20]` |

### 2.1 The platform decision, stated plainly

**Owner and manager are Expo Router apps whose primary target is web. They are not a separate web-first React app.** All six apps are one Expo Router codebase each, one SDK, one router, one styling system, one data layer. The two desk apps declare `web` as their primary target and **fork only their dense leaves to real DOM** through Metro platform extensions — `Register.web.tsx` returns a real `<table>` driven by TanStack Table; `Register.native.tsx` returns a `FlashList` of cards. Route tree, tokens, money logic, auth session and query layer are shared and never forked. This is `[UX-03 D1]` and the reasoning is not repeated here.

The design consequence, which is the part that belongs in this document: **every desk screen is designed twice, on purpose, at two densities, in the same pass.** A register is a keyboard-driven grid on web and the same data as a scrollable card list on phone. Do not design one layout and hope it reflows — the code forks at exactly that seam, so the mockups must too.

**The fork budget is 18 `.web.tsx` files across owner + manager, counted in CI** `[UX-03 §1 tripwire]`. If a design calls for a 19th, that screen is redesigned as a card list. If a *field* app ever needs a `.web.tsx` for layout, that is a design failure, not a platform gap.

### 2.2 Six apps, and a stale doc to fix

The build log confirms seven services running on **:3000 auth, :3001 owner, :3002 manager+accountant, :3003 sales, :3004 warehouse, :3005 delivery, :3006 retailer** (`docs/18-build-log.md`, session 3). `docs/02-five-apps-and-surfaces.md` and `CLAUDE.md` still describe five services and "two store binaries plus one web console"; those are stale and should be amended to the six-app matrix. This document assumes six.

---

## 3. Colour

### 3.0 How colour works here

- Colours exist **only as semantic tokens** generated from private primitive ramps. No screen writes a hex. Lint: no hex literal outside `tokens.ts` `[UX-02 R1]`.
- **One accent.** Petrol is the primary action and the selected state, and nothing else. Status colours are a separate family and never compete with it `[UX-02 R2]`.
- **Colour is never the only channel.** Every state is colour **+** icon **+** word, always all three — for colour-blind users, for a ₹9,000 LCD, for direct godown sun, and because the word is what a screen reader speaks `[UX-01 U3]`, `[UX-03 §14c]`.
- **Every text-on-surface pair below is ≥ 7:1** (WCAG AAA), not 4.5:1, because a 450–600 nit panel under 80,000 lux has no contrast headroom to spend `[UX-01 U2]`. Ratios below were computed, not estimated.
- **Dark mode is a desk feature.** Dark UI is *worse* outdoors — ambient reflection adds the same absolute luminance to every pixel, and a light UI swamps it by putting most of the screen at peak white `[UX-01 §1.1]`. Field apps do not read `useColorScheme()` at all.

### 3.1 Primitive ramps (private — never referenced by a screen)

**`paper`** — a warm neutral. Deliberately not the cool `#F8FAFC` slate every dashboard uses, and deliberately not cream.

| token | hex | | token | hex |
| --- | --- | --- | --- | --- |
| `paper.0` | `#FFFFFF` | | `paper.500` | `#8E9188` |
| `paper.50` | `#F8F8F6` | | `paper.600` | `#6A6E66` |
| `paper.100` | `#F2F2EF` | | `paper.700` | `#4B4F49` |
| `paper.200` | `#EAEAE5` | | `paper.800` | `#3F433D` |
| `paper.300` | `#D5D6CF` | | `paper.900` | `#2A2D28` |
| `paper.400` | `#B3B5AC` | | `paper.950` | `#15181B` |

**`petrol`** — the accent. A deep blue-green. Chosen because it is dark enough to carry white text at AAA (7.90:1), because it is nowhere near red, amber or green so it never reads as a status, and because Indian distribution software is uniformly saffron, red or Bootstrap blue — petrol is unclaimed, and it sits calmly next to an arbitrary distributor logo.

| token | hex | | token | hex |
| --- | --- | --- | --- | --- |
| `petrol.50` | `#EBF3F4` | | `petrol.500` | `#3E8E97` |
| `petrol.100` | `#D6E7E9` | | `petrol.600` | `#0E6E78` |
| `petrol.200` | `#B7CFD1` | | `petrol.700` | `#0B5A63` |
| `petrol.300` | `#7FB3B8` | | `petrol.800` | `#07454C` |
| `petrol.450` | `#5F969B` | | `petrol.900` | `#05353B` |
| `petrol.onDark` | `#5FC7D2` | *(not a step in the light ladder — the accent as it appears on dark surfaces only)* | | |

**Status hues.** Four families, each with a text tone (≥7:1 on white), a tint, an edge (≥3:1 on white, so a chip has a visible border in sunlight), and an on-dark tone.

| family | `.tint` | `.edge` | `.fg` (text / solid fill) | `.onDark` |
| --- | --- | --- | --- | --- |
| `moss` — positive | `#E8F4EA` | `#4E9270` | `#0F5B2E` | `#6FD08F` |
| `ochre` — caution | `#FDF4E3` | `#A8832F` | `#6E4200` | `#E8B44F` |
| `clay` — the 61–90 ageing step only | `#FBEDE0` | `#A05C1F` | `#8A4008` | `#E09A5C` |
| `brick` — critical | `#FDEFED` | `#BE6A63` | `#9E1C1C` | `#F08A82` |

**`slate`** — dark-theme surfaces (desk only): `slate.950 #101315` · `slate.900 #181B1E` · `slate.800 #20252A` · `slate.700 #2B3035` · `slate.500 #6E767F`.

### 3.2 Semantic tokens (this is what screens use)

| token | light | dark (desk only) | ratio, light |
| --- | --- | --- | --- |
| `bg.ground` — the canvas | `paper.100` `#F2F2EF` | `slate.950` `#101315` | — |
| `bg.surface` — cards, rows, sheets | `paper.0` `#FFFFFF` | `slate.900` `#181B1E` | — |
| `bg.raised` — menus, hover, popovers | `paper.50` `#F8F8F6` | `slate.800` `#20252A` | — |
| `bg.sunken` — wells, disabled fields, chart plot area | `paper.200` `#EAEAE5` | `slate.950` `#101315` | — |
| `text.primary` | `paper.950` `#15181B` | `#F2F3F1` | **17.82:1** on surface, 15.89:1 on ground |
| `text.secondary` | `paper.700` `#4B4F49` | `#B9BEB9` | **8.35:1** on surface, 7.45:1 on ground |
| `text.tertiary` — **desk only, never in a field app** | `paper.600` `#6A6E66` | `#8E958E` | 5.20:1 |
| `text.onAccent` / `text.onSolid` | `#FFFFFF` | `slate.950` `#101315` | see below |
| `border.hairline` — decorative separators only | `paper.300` `#D5D6CF` | `slate.700` `#2B3035` | 1.46:1 *(decorative; carries no information)* |
| `border.strong` — input outlines, chip edges, anything that conveys state | `paper.500` `#8E9188` | `slate.500` `#6E767F` | **3.20:1** / 3.76:1 |
| `accent.fg` — links, active tab label, selected icon | `petrol.700` `#0B5A63` | `petrol.onDark` `#5FC7D2` | **7.90:1** on surface, 7.05:1 on ground |
| `accent.solid` — primary button fill | `petrol.700` `#0B5A63` | `petrol.onDark` `#5FC7D2` | white on it = **7.90:1**; dark ink on onDark = 9.40:1 |
| `accent.pressed` | `petrol.800` `#07454C` | `#7FD6DF` | white on it = 10.69:1 |
| `accent.tint` — selected row, active filter chip | `petrol.50` `#EBF3F4` | `#123037` | accent text on it = **7.02:1**; ink on it = 15.50:1 |
| `accent.edge` | `petrol.450` `#5F969B` | `petrol.500` | 3.32:1 |
| `focus.ring` | `petrol.700` `#0B5A63` | `petrol.onDark` | 2 px ring + 1 px `bg.surface` inner halo |

### 3.3 Domain semantics — the colours that mean something here

Every one of these is rendered as a `StatusPill`: **tint background + `.edge` 1 px border + `.fg` text + a 16 dp icon + the word.** The `solid` variant (white text on `.fg`) is reserved for the three states that must be seen across a godown: **Out of stock, Overdue, Failed.**

**Stock** — `sellable_stock`, shown to sales, warehouse, retailer:

| state | family | word on screen | icon |
| --- | --- | --- | --- |
| In stock | `moss` | "In stock" | filled circle |
| Low — below the reorder point | `ochre` | "Low · 4 cs" | half circle |
| Out of stock | `brick` **solid** | "Out of stock" | hollow circle with a slash |
| Not carried by this distributor | `neutral` (`paper.200` / `paper.500` / `paper.800`) | "Not stocked" | dash |

**Money state** — an invoice's payment state (`billing.invoices.state`):

| state | family | word |
| --- | --- | --- |
| Paid | `moss` | "Paid" |
| Partly paid | `ochre` | "Part paid · ₹4,200 left" |
| Due (open, not yet past due date) | `neutral` | "Due 12 Sep" |
| Overdue | `brick` **solid** | "Overdue · 14 days" |
| Cancelled / written off | `neutral`, text struck through | "Cancelled" / "Written off" |

**Delivery outcome** — set only by the person at the stop, with proof `[UX-01 R6]`:

| state | family | word |
| --- | --- | --- |
| Delivered | `moss` | "Delivered" |
| Partial | `ochre` | "Partial · 2 of 6 lines short" |
| Failed | `brick` **solid** | "Failed · shop shut" |
| Not yet attempted | `neutral` | "Stop 4 of 11" |

**Approval** — bargain, credit override, MOV, price variance, red settlement:

| state | family | word |
| --- | --- | --- |
| Approved | `moss` | "Approved by Sunil · 10:42" |
| Pending | `ochre` | "Waiting for owner" |
| Rejected | `brick` | "Rejected — over credit limit" *(reason always shown to the requester)* `[UX-02 R29]` |

**Ageing** — an ordered four-step ladder, not four unrelated colours. It appears as pills, as the ageing-bucket chart, and as the ageing register's column headers, and it is always the same four colours in the same order:

| bucket | tint | edge | fg | ratio (fg on tint) |
| --- | --- | --- | --- | --- |
| 0–30 days | `paper.200` `#EAEAE5` | `paper.500` `#8E9188` | `paper.800` `#3F433D` | **8.36:1** |
| 31–60 days | `ochre.tint` `#FDF4E3` | `#A8832F` | `#6E4200` | **7.87:1** |
| 61–90 days | `clay.tint` `#FBEDE0` | `#A05C1F` | `#8A4008` | 6.49:1 on tint, **7.45:1** on white |
| 90+ days | `brick.tint` `#FDEFED` | `#BE6A63` | `#9E1C1C` | **7.11:1** |

**Connection / data provenance** — one chip, never a modal, never a button `[UX-01 U16]`, `[UX-02 R25]`:

| state | family | text |
| --- | --- | --- |
| Synced | `neutral` (no fill, `text.secondary`) | "Updated 2 min ago" |
| Changes waiting | `ochre` | "3 orders waiting" |
| Offline | `neutral` with a struck cloud icon | "Offline since 10:42" |
| Data stale > 4 h | `ochre` | "Stock as of 9:40 am" |
| Needs attention (a `sync_errors` row) | `brick` | the business reason in plain English, as a work item `[UX-02 R30]` |

### 3.4 Chart colour

Charts do **not** get their own rainbow. `[UX-02 R23]`

- **Trend and comparison:** current series `petrol.700`, comparison/previous series `paper.400`, target/benchmark a 1 px dashed `paper.500`. Two colours, and the current one is the accent.
- **Categorical mix (brand mix, category mix, payment-mode mix):** a single-hue ordered ramp — `petrol.700` → `petrol.500` → `petrol.300` → `petrol.200` → `paper.700` for "Other". Maximum five slices; a sixth becomes "Other". Adjacent steps are 1.42–2.08:1 apart, which separates on a cheap LCD, and the ramp is colour-blind-safe by construction because it is one hue.
- **Charts whose subject *is* a status** (ageing buckets, delivery outcomes, approval queue age) use the domain semantics above and nothing else.
- No 3D, no shadows, no gradients, no donut past five slices `[UX-02 §3 item 19]`.

### 3.5 Colour rules a reviewer can check

1. If you can point at a colour and it is not in §3.2/§3.3/§3.4, the screen fails.
2. If a state is legible only because of its hue, the screen fails.
3. If any text in a field app sits below 7:1, the screen fails. Desk `text.tertiary` at 5.20:1 is the only exception and is banned from sales, warehouse, delivery and retailer.
4. `border.hairline` may never be the only thing indicating an interactive boundary — inputs, chips and toggles use `border.strong`.
5. A surface has **either** a hairline **or** a shadow, never both, and cards never nest inside cards.

### 3.6 The product mark, and the white-label rule

The founder asked for a brand and confirmed the product is white-labelled (`docs/17` §D row 6). Two separate things, and conflating them is the mistake to avoid.

**The distributor's brand** — their business name and logo, from `tenant_settings.display_name` / `logo_asset_id` — appears in exactly four places: the app's top-left chrome on every screen of every app, the sign-in landing after a tenant is identified, every generated document (invoice, statement, delivery challan, credit note), and every WhatsApp message body. **The distributor supplies a name and a logo; they do not supply a colour.** A distributor's logo can be any colour including neon yellow, and every contrast guarantee in §3 would collapse if the accent were tenant-controlled. The logo is rendered inside a fixed 32 dp (phone) / 28 px (desk) box on `bg.surface`, with a `paper.300` hairline if the logo has no natural edge, and never tinted. If no logo is uploaded, the fallback is the distributor's initials in `text.primary` on `paper.200`.

**Distribution OS's own brand** appears in exactly two places: the sign-in screen, and the app-store listing. Nowhere else, ever, on any surface a retailer or a rider sees.

**Proposed mark** (needs the founder's yes — §12): a wordmark set in IBM Plex Sans SemiBold, `text.primary`, with the two words on one line and no tagline, preceded by a 24 dp glyph: a **filled `petrol.700` rounded square containing two white horizontal bars of unequal length**, read as a stock line and a shorter shipped line — a ledger entry, not a truck, not a box, not a globe. It works at 16 dp in a tab bar, in one colour on a thermal print, and as a monochrome favicon. Three name options are in §12; the mark works with any of them.

---

## 4. Typography

### 4.1 The typeface: IBM Plex Sans

**One family across all six apps and all three platforms: IBM Plex Sans** (SIL Open Font License, on Google Fonts and GitHub). Not Inter. The reasons are measured, not aesthetic — I inspected both font binaries:

| | IBM Plex Sans | Inter |
| --- | --- | --- |
| Digit advance widths, Regular | `600, 600, 600, 600, 600, 600, 600, 600, 600, 600` — **tabular by default** | `1292, 833, 1249, 1265, 1323, 1215, 1270, 1159, 1267, 1270` — **proportional by default** |
| Digit widths at SemiBold 600 / Bold 700 | 600 at every weight — a money column stays aligned when a row goes bold | requires `tnum` at every weight |
| Tabular figures require an OpenType feature? | **No.** Plex has no `tnum` because it does not need one | **Yes.** Depends on `fontVariant: ['tabular-nums']` firing on the device |
| `₹` U+20B9 | present | present |
| Devanagari sibling | **IBM Plex Sans Devanagari** — same family, same 1000 upem, **same 600-unit digit advance**, drawn by the same team (Erin McLaughlin) | none; would need Noto Sans Devanagari — a foreign family |

That second-to-last row is the decisive one. Tabular figures are the single cheapest credibility signal in a money product `[UX-02 R4]`, and with Plex we get them **structurally**, with no feature flag that can silently fail to apply on a 4 GB Android. With Inter, every money view in six apps depends on `fontVariant` working — which it does, on Android since RN 0.62, but it is one more thing that can be forgotten on one component and produce a jittering column. The last row is the second reason: when Marathi/Hindi arrives, it is a **sibling in the same family with an identical digit metric**, so a translated invoice keeps the exact same column alignment. That turns the later i18n pass from a redesign into a font swap `[UX-01 U15]`.

Third reason, worth saying out loud: Inter is what every AI-designed and template-designed product in 2026 is set in. Plex is a specific choice.

**Loading:**

- **Native: static instances only.** Expo's own docs: *"Variable fonts, including variable font implementations in OTF and TTF, do not have support across all platforms… For full platform support, use static fonts"* ([Expo — Fonts](https://docs.expo.dev/develop/user-interface/fonts/)). Ship exactly **four static weights — Regular 400, Medium 500, SemiBold 600, Bold 700** — embedded at build time via the `expo-font` config plugin, so they are present at first frame with no async load and no flash. No italics anywhere in the product. Four files ≈ 240 KB, inside the 40 MB download budget `[UX-01 U12]`.
- **Web:** the variable `IBMPlexSans[wdth,wght].ttf` self-hosted (never a Google Fonts CDN link — the CSP and the offline story both want it local), `font-display: swap`, with a `system-ui` fallback stack that has the same metric intent.
- **Fallback stack everywhere:** `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.
- **No second family.** No monospace. If something needs to align, it is a number, and numbers already align.

### 4.2 Type scale — field (sp; 1 sp = 1 dp)

Body floor 16 sp, money floor 20 sp, never below 14 sp `[UX-01 U8]`.

| token | size / line-height / weight | use |
| --- | --- | --- |
| `field.hero` | 32 / 38 / 600 | The one number the screen exists to show: owner tile, "Collect ₹4,820", trip variance, outstanding on the retailer's first screen |
| `field.keypad` | 44 / 52 / 600 | The gate-count digits and the cash-collected digits. Nothing else on that screen `[UX-01 W2]` |
| `field.moneyL` | 24 / 30 / 600 | Invoice total, order total, per-bill outstanding, the disputed-quantity screen `[UX-01 D5]` |
| `field.moneyM` | 20 / 26 / 600 | Line totals, MRP, rate, quantity figures, every money value in a list row |
| `field.title` | 20 / 26 / 600 | Screen title, shop name, section heading |
| `field.body` | 16 / 22 / 400 | Everything readable |
| `field.bodyStrong` | 16 / 22 / 600 | Product name in a list row, the word inside a status pill |
| `field.label` | 14 / 18 / 500 | Field labels, metadata, timestamps. **Never a number a decision is made on** |

Nothing below 14 sp exists in a field app. There is no caption size.

### 4.3 Type scale — desk (px)

| token | size / line-height / weight | use |
| --- | --- | --- |
| `desk.kpi` | 28 / 34 / 600 | Dashboard tile value |
| `desk.pageTitle` | 24 / 30 / 600 | Page header |
| `desk.section` | 18 / 24 / 600 | Panel and card headings |
| `desk.body` | 15 / 22 / 400 | Prose, form values |
| `desk.cell` | 14 / 20 / 400 | Table cell text |
| `desk.cellMoney` | 14 / 20 / 500 | Table money cell — right-aligned, tabular |
| `desk.label` | 13 / 18 / 500, `text.secondary` | Field labels, column headers, metadata |

Column headers are **sentence case, medium weight, `text.secondary`**. Never ALL CAPS with wide tracking — that is a Material 2 tell `[UX-02 §3 item 11]`.

### 4.4 The number rules

These are the rules that make this look like a financial product instead of a template.

1. **Every number in the product is tabular.** Guaranteed by the typeface (§4.1); belt and braces, the `<Money>` and `<Qty>` primitives also set `fontVariant: ['tabular-nums']` so a future typeface change cannot silently break alignment.
2. **Money is integer paise in and integer paise out, always.** No float ever enters a component. `<Money value={paise} />`, `<RupeeInput value={paise} onChange={paise => …} />` `[CLAUDE.md]`.
3. **Indian digit grouping, always:** `₹1,24,500.00`, via `Intl.NumberFormat('en-IN')` with the lakh/crore fallback in `@dos/domain`. Never `₹124,500.00` `[UX-02 R24]`.
4. **Hero money is composed, column money is not.** In a *hero* figure (tile, invoice total, collect amount) the `₹` and the paise are set at **0.72 em, one weight lighter, `text.secondary`**, and the integer part carries full size, weight and `text.primary`. In a *column* — any table, any list of money — every character is the same size and weight, right-aligned, fixed to two decimals. Mixing sizes inside a column breaks the alignment the typeface just bought us.
5. **Fixed precision down a column.** Two decimals, always, even for `.00`. A column where some rows show paise and some do not is the single loudest amateur tell.
6. **Quantity is always dual-unit and never toggled:** `2 cs + 6 pc = 186 pcs`. Case size comes from `tenant_products.case_size_override` else `product_variants.default_case_size` `[UX-01 W5, S3]`, `[CLAUDE.md]`.
7. **Dynamic type:** labels and body scale freely with the OS font setting; **numeric text carries `maxFontSizeMultiplier={1.3}`**, and every row must wrap to two lines without clipping at 200% `[UX-03 §14b]`. `allowFontScaling={false}` is banned.
8. **Screen readers get words, not glyphs.** Every `<Money>` sets `accessibilityLabel={speakMoney(paise)}` → "one lakh twenty four thousand five hundred rupees" `[UX-03 §14c]`.
9. **Label budget: 20 characters.** Every string lives in one catalogue per app so the later Marathi pass is a swap, not a rewrite `[UX-01 U15]`, `[UX-02 R8]`.

---

## 5. Space, shape, elevation

### 5.1 Spacing

One 4 px base scale, used by both densities:

`space.0 = 0` · `1 = 4` · `2 = 8` · `3 = 12` · `4 = 16` · `5 = 20` · `6 = 24` · `8 = 32` · `10 = 40` · `12 = 48` · `16 = 64`

- **Field screen gutter:** `space.4` (16). **Desk page gutter:** `space.6` (24), content column max 1200 px.
- **Vertical rhythm inside a card:** `space.3` between label and value, `space.4` between groups, `space.6` between sections.
- **Minimum gap between adjacent tap targets: 19 dp (3 mm). Minimum gap between a confirming action and a destructive one: 50 dp (8 mm)** `[UX-01 U6]`. In practice that means Deliver / Partial / Failed are 3 buttons with 50 dp between the safe pair and the failing one, not a 3-up segmented control.
- **Touch target floors:** 69 dp field · 76 dp warehouse and delivery primary actions · 63 dp anywhere else on a phone. Material's 48 dp is 7.6 mm and Apple's 44 pt is ~7 mm — **both are below the floor for handheld use and neither is our minimum** `[UX-01 U6]`. The existing `touch.minTarget = 48` in `frontend/libs/ui/src/tokens.ts` must be replaced.

### 5.2 Radii

`radius.sm = 8` (inputs, chips, small controls) · `radius.md = 12` (cards, buttons, list rows) · `radius.lg = 18` (dialogs, panels) · `radius.xl = 28` (bottom-sheet top corners only) · `radius.full = 999` (**status pills and avatars only**).

A primary button is `radius.md`, not a pill. Pill buttons read consumer; this is an instrument.

### 5.3 Borders

- `border.hairline` 1 px, decorative separation only. A list uses hairlines *between* rows, never a box around every row.
- `border.strong` 1 px for anything that conveys state or interactivity: input outlines, chip edges, the unchecked checkbox, the table's frozen-column edge.
- **Focus ring** (desk, and any web build): 2 px `focus.ring` outline offset 2 px, plus a 1 px `bg.surface` halo so it reads on both light fills and accent fills. React Native Web's `Pressable` strips outlines by default — **restore `:focus-visible` in the generated `tokens.css`** `[UX-03 §14c]`. A desk app that cannot be driven from the keyboard will be rejected by the accountant who lives in it.

### 5.4 Elevation — and when it is allowed

Elevation is allowed on **exactly four things**, and nowhere else:

1. Bottom sheet — `0 -2px 16px rgba(21,24,27,0.12)`
2. Dialog / modal — `0 8px 32px rgba(21,24,27,0.16)`
3. A sticky bottom action bar, **only while content is scrolled under it** — `0 -1px 8px rgba(21,24,27,0.08)`, animated in over 150 ms
4. Menus, dropdowns, autocomplete popovers — `0 4px 16px rgba(21,24,27,0.12)`

Cards, list rows, tiles, tables, chips and inputs are **flat**: `bg.surface` on `bg.ground`, separated by the ground colour itself or a hairline. Border **and** shadow **and** radius on the same element is the 2014 admin-template tell `[UX-02 §3 item 3]`.

**On dark surfaces, elevation is lightness, not shadow:** ground `slate.950` → surface `slate.900` → raised `slate.800`. Shadows are invisible on dark and only cost GPU.

**Liquid Glass / translucency: no.** `expo-glass-effect` is iOS 26+ and silently degrades to an opaque `View` everywhere else, and translucency behind text is a contrast risk `[UX-02 §1.2]`. One visual language on both platforms; we take the *idea* — content leads, chrome is a thin functional layer that shrinks as you scroll — and implement it with opacity and elevation we control.

---

## 6. Components

The shared library lives in `frontend-apps/shared-ui`. **A screen may import from `shared-ui`, `@dos/domain` and `@dos/contracts` only** — never `react-native` primitives except `View`, never `expo-haptics`, never a chart library. If a screen needs something the platform gives it directly, that is a missing `shared-ui` component. Enforced with an ESLint `no-restricted-imports` rule `[UX-03 §15]`.

Every component below states its states. **The universal press rule: a tap produces a visible change within one frame (≤100 ms), always, even when the work behind it takes seconds** `[UX-02 R19]`.

### 6.1 Buttons

| variant | fill | text | use |
| --- | --- | --- | --- |
| `primary` | `accent.solid` | white | The one commit on the screen. **One per screen.** |
| `secondary` | `bg.surface` + `border.strong` | `text.primary` | Alternatives ("Add another line", "Type code") |
| `ghost` | none | `accent.fg` | Tertiary, in headers and rows |
| `destructive` | `bg.surface` + `brick.edge` border | `brick.fg` | Cancel invoice, void receipt, fail delivery. **Never a solid red button** — a solid red primary invites the accidental tap this product cannot afford |

**States:** `default` · `pressed` (fill → `accent.pressed`, scale 0.98, 80 ms) · `disabled` (`bg.sunken` fill, `paper.500` text, **and a one-line reason underneath — a disabled button with no reason is a dead end**) · `loading` (label stays, a 16 dp determinate spinner replaces the icon slot, button width does not change, further taps are swallowed by the `idempotencyKey`) · `success` (200 ms: label → the outcome word + check, then the screen advances).

Heights: field 56 dp minimum, 64 dp for a screen's primary commit, 72 dp in warehouse/delivery. Desk 36 px. Full-width on phone; auto-width on desk. Label = verb + object, ≤20 characters, in the user's words: "Place order", "Post GRN", "Issue invoice", "Confirm delivery", "Record payment", "Close trip". **Never "Submit", "OK", "Done" or "Save" for anything that writes a ledger** (§9).

### 6.2 Text input

Field label above (never a floating placeholder-label — it disappears exactly when you need it), 14 sp `text.secondary`; input 16 sp minimum (below 16 px iOS Safari zooms on focus); `border.strong` outline, `radius.sm`; helper text below, reserved height so the layout does not jump when an error appears.

**States:** `default` · `focused` (2 px `focus.ring`) · `filled` · `disabled` (`bg.sunken`, no outline) · `readonly` (no outline, `text.primary`, selectable) · `error` (`brick.edge` outline + `brick.fg` message stating the business problem and the next action) · `loading` (async validation: a 14 dp spinner inside the trailing slot, never a blocked field).

Never `<input type="number">` — browser spinners, locale comma rejection, inconsistent decimals `[UX-02 R21]`.

### 6.3 `<Money>` and `<RupeeInput>` — paise in, paise out

`<Money value={paise} size="moneyM" />` renders read-only money per §4.4. `<RupeeInput value={paise} onChange={paise => …} />` is the input.

- **Field apps: the input is a keypad, not a text field.** Tapping the value opens `<NumberPad>` full-screen (`field.keypad` 44 sp digits, 76 dp keys, a running formatted preview at the top, Clear and Done). Desk: a real text field with `inputMode="decimal"` — there is a keyboard there `[UX-02 §4.2]`.
- `₹` is always visible as a fixed prefix, never as placeholder text.
- **Format on blur, never on every keystroke.** Accepts `1234`, `1,234`, `1234.5`; emits `123450` paise.
- **No silent clamping.** If the amount exceeds a bound (over credit limit, above the rep's discount authority, more than the bill's balance), the field *accepts it* and the screen states what will happen — "₹12,400 over limit. Needs Sunil's approval." Snapping a number back under the user's finger is the classic web-app failure against Tally `[UX-01 O5]`, `[UX-02 §4.2]`.
- Cash collection specifically: **the expected amount is displayed above the input and never pre-filled into it.** Pre-filling is what produces false settlements `[UX-01 D6]`.

### 6.4 `<QtyStepper>` — cases and pieces

The most-used control in the product. `−` and `+` at 69 dp (76 dp in warehouse), separated from the value by `space.3`, value in `field.moneyM`.

- **Both units always visible, never a toggle:** the control reads `2 cs + 6 pc` with `= 186 pcs` beneath it in `field.label`, and the case size is printed on the control: `1 case = 90 pcs` `[UX-01 W5]`.
- `+`/`−` **step by case.** **Long-press opens the pieces keypad** — and a visible "Pieces" button does the same thing, because no gesture is the only way to do anything `[UX-01 U7]`, `[UX-02 R22]`.
- Defaults to the last ordered quantity for that shop `[docs/08]`.
- **States:** `default` · `stepping` (selection haptic per tick, value animates 80 ms) · `at zero` (`−` disabled, row shows "Not ordered") · `over ATP` (`ochre` — "Only 14 cs available. Rest will be short-supplied.", still accepted) · `blocked` (`brick`, with the reason and the approval path) · `disabled`.
- An `ATP` badge sits on the row, sourced from `sellable_stock`. **Availability shown is availability reserved** `[UX-01 R4]`.
- Every line shows its applied scheme in rupees at ≥16 sp, because the scheme shown at order time is the scheme the invoice prints `[UX-01 S8]`.

### 6.5 Search

- Opens the keyboard on mount only when search *is* the screen; otherwise it is a 69 dp row that pushes to a search screen.
- **Local-first and debounced 200 ms against the on-device catalog.** A network round trip per keystroke on 4G is what makes competitors feel slow `[UX-02 §6.2]`.
- Results appear under the field, not in a dropdown overlay; the first result is always reachable by thumb.
- **States:** `idle` (recent + last-ordered for this shop, never blank) · `typing` (results update in place; no spinner under 300 ms) · `no results` (the query echoed + "Add as new item" where the role permits) · `error` (cached results shown, labelled with their age).
- Desk: `/` focuses search from anywhere; `⌘K` opens the global command palette.

### 6.6 `<ListRow>`

The workhorse. Phone: 76–96 dp tall, `bg.surface`, hairline between rows, `space.4` horizontal padding.

Structure is fixed so six apps look like one product: **leading slot** (avatar / icon / checkbox, 40 dp) · **primary line** (`field.bodyStrong`) · **secondary line** (`field.label`, `text.secondary`, one line, ellipsised) · **trailing stack, right-aligned** (money in `field.moneyM` on top, a `StatusPill` beneath).

**The rule that keeps lists fast: a row does zero derivation.** No ageing bucket computed on device, no five money values formatted per row, no per-row chart. The backend already pre-aggregates (`owner_summary`, `retailer_behaviour`, `daily_rep_stats`); a row that recomputes silently undoes that and will drop frames on the reference device `[UX-03 D6]`.

**States:** `default` · `pressed` (`bg.raised`, 80 ms) · `selected` (`accent.tint` fill + 3 px `accent.solid` leading bar) · `disabled` · `waiting to send` (a small `ochre` clock glyph in the trailing stack) · `needs attention` (`brick` leading bar + the reason on the secondary line).

Swipe actions are **accelerators only**, never destructive, always with a visible tap equivalent on the same screen. **In the delivery app there are no swipe actions at all** — wet fingers `[UX-01 D9]`.

### 6.7 `<DataSurface>` — the register that degrades to cards

One props contract, two renderings `[UX-03 D6]`.

**Web (`.web.tsx`):** a real `<table>` with TanStack Table — sticky `<thead>`, **frozen first column** (the retailer/item/invoice identity), right-aligned tabular money columns, column-visibility control, text selection, right-click, `Cmd+P` print stylesheet, and TanStack Virtual past ~200 rows. Row height 32 px, cell text 14 px `[UX-01 O8]`. **Every register must fit a typical month without horizontal scroll at 1366×768** — that is the resolution actually on the desk.

**Native (`.native.tsx`):** a `FlashList` of `<ListRow>`s using the column-priority order — identity + the one number that matters + a status pill; the rest one tap away.

**States:** `loading` (content-shaped skeleton, §6.16) · `empty` (§6.14) · `error` (§6.15) · `partial` (rows shown, a labelled "as of" chip) · `filtered` (an explicit chip row showing what is filtered, with a one-tap clear).

Non-negotiable on both: **export and A4 print controls visible without scrolling on every register** `[UX-01 O6]`. "Distributors cannot get their own data out" is a documented top complaint about the incumbents and is a selling point here.

### 6.8 `<Sheet>` and `<Dialog>`

**Bottom sheet is a phone pattern only.** Native: `@gorhom/bottom-sheet` v5, `radius.xl` top corners, a 32×4 dp `paper.400` grab handle, `insets.bottom` respected, backdrop `rgba(21,24,27,0.32)`, dismissible by tap-outside and by a visible Close button. **Desk: a focus-trapped `<dialog>` or a right-hand side panel** — a bottom sheet on a 24-inch monitor is wrong UI, not a compatibility gap `[UX-03 D8]`.

**Dialogs are reserved for the four irreversible commits and nothing else:** issue invoice, post GRN, close trip, approve a credit override `[UX-02 R26]`. Every reversible action gets **undo** instead. A dialog states exactly what will be written ("Invoice GL/1688 · ₹18,420 · stock leaves Kalyan godown"), and its confirm button carries the real verb.

### 6.9 Tabs, chips and filters

- **Tabs:** maximum 4 on phone, no truncated labels, no icons-only. Underline indicator 3 px `accent.solid`, animated 150 ms. Label + count ("Pending 4"). Never a scrolling tab strip in a field app.
- **Filter chips:** `radius.sm`, 44 dp tall, `border.strong` when unselected, `accent.tint` fill + `accent.edge` when selected, with a check glyph. Selected count always visible. A filter row never scrolls off-screen without a visible "3 filters" summary.
- **Segmented control** (2–3 mutually exclusive options only): full-width, 56 dp, `bg.sunken` track, `bg.surface` thumb with a hairline. Use `@expo/ui`'s native segmented control where a native control is genuinely better `[UX-03 D9]`.
- **No bottom tab bar with more than 4 tabs; no truncated tab labels** `[UX-02 §3 item 6]`.

### 6.10 `<StatusPill>`

`radius.full`, 28 dp tall (32 dp in warehouse), `space.2` horizontal padding, **16 dp icon + word**, tint fill + 1 px `.edge` border. Solid variant (white on `.fg`) for the three loud states only (§3.3). Never a bare coloured dot. Never colour without the word.

### 6.11 `<ConnectionStrip>` — the honesty contract

One persistent, **non-blocking** strip under the app header on every screen of every app. Three states, one line, from `useConnection() → { online, lastSyncedAt, pendingWrites }`:

- `Updated 2 min ago` — `text.secondary`, no fill
- `3 orders waiting` — `ochre` tint; tapping opens the list of what is waiting, never a send action
- `Offline since 10:42` — neutral tint, struck-cloud icon

**There is no "Sync now" button and no "Refresh" as the primary path to current data. There is never a modal for sync, GPS, permission or connectivity** `[UX-01 U16]`, `[UX-02 R25, R27]`. This is the single most-cited failure of Bizom, FieldAssist and Botree, over six years of Play reviews, and not repeating it is a feature we sell. When PowerSync lands for sales and delivery, only the source of `pendingWrites` changes — **no screen changes**.

Data-age escalation: fresh is unmarked; minutes are relative; over 4 hours the strip turns `ochre` and names the time ("Stock as of 9:40 am"); on the order screen, prices quoted from a cached price list are explicitly labelled, because that is exactly the doorstep dispute `[operational-pain-points #27]`.

### 6.12 `<Toast>`

**Toasts exist for one purpose: undo.** They are never the record that something happened — the screen itself shows that `[UX-02 §3 item 24]`. 4 seconds, one at a time, bottom of the screen above the action bar and above `insets.bottom`, `bg.raised` with `radius.md` and the dialog shadow, containing the outcome in ≤6 words and an Undo action at ≥44 dp. No haptic on a toast. No success toast after a routine action.

### 6.13 `<Avatar>`

Initials in `field.bodyStrong` `text.primary` on `paper.200`, `radius.full`, 40 dp in rows / 32 dp in headers. **No photographs** (bandwidth, and a rider's face is not our data to hold), and **no colour-coded identity rings** — colour is spoken for. A shop's avatar is the first letter of the shop name; a person's is two initials.

### 6.14 `<EmptyState>`

Three parts, maximum: a 32 dp `paper.500` icon, **one line of ≤8 words**, and the primary action as a `secondary` button. **No illustrations. No paragraphs.** The flow must be completable by someone who cannot read the sentence, so the icon and the button label carry it `[UX-01 U15]`.

Every empty state names the *next* thing, not the absence: "No stops left — trip can be closed" with a Close trip button; not "There are no items to display."

### 6.15 `<ErrorState>`

**Business language and the next action, never a code and never a red toast that disappears** `[UX-02 R30]`. A `sync_errors` row from `/sync/upload` — which is a 2xx business outcome by design (ADR 0007) — becomes a **"Needs attention" work item in the list**, not an error screen: *"Kirana Mart order — credit limit reached, ₹12,400 over. Ask Sunil to approve?"* with the approve-request button attached.

A technical code, if one exists, lives behind a "Details" disclosure for support. `brick.tint` background, `brick.fg` text, `brick.edge` border, a 24 dp icon, and never a full-screen takeover if any usable cached content exists.

### 6.16 `<Skeleton>` and loading

Threshold-based, baked into the kit so no screen decides for itself `[UX-02 R16]`:

- **< 300 ms: show nothing.** Never flash a spinner.
- **300 ms – 1 s:** a subtle inline indicator in the affected region only.
- **> 1 s:** a **skeleton shaped like the content that is coming** — `paper.200` blocks at the real row heights, a 1.2 s cross-fade pulse, **static under reduce-motion**.
- **Never a full-screen spinner on a screen whose shape we already know**: beat list, stop list, order queue, GRN queue, catalog, ageing, billing desk.
- **Every screen visited before repaints instantly from the persisted query cache and revalidates behind the connection strip.** On patchy 4G this is the difference between "fast app" and "broken app" `[UX-03 §13]`.

### 6.17 Pull-to-refresh

Allowed on list screens as the platform gesture people already expect — and that is all it is. It is never the documented way to get current data, it never appears as a button, and it fires **no haptic**. Data refreshes on focus and on interval regardless.

### 6.18 The chart set

Five components in `shared-ui/charts`, one props contract, two implementations: `.native.tsx` on `react-native-svg` + `d3-scale`/`d3-shape`, `.web.tsx` on Recharts. Scales, tick formatters, IST business-date axis and the colour ramp live in `@dos/domain` so the two renderers cannot drift `[UX-03 D5]`. **A screen never imports a chart library.**

| component | shape | where |
| --- | --- | --- |
| `<TrendChart>` | Single line, 30–90 points, 2 px `petrol.700`, optional `paper.400` comparison line, no area fill, no dots except the last point | Owner: sales trend, collections trend, outstanding trend |
| `<CompareBars>` | Grouped vertical bars, current `petrol.700` vs previous `paper.400`, max 12 categories | Owner: this month vs last, brand-wise, beat-wise |
| `<StackedMix>` | One horizontal 100% stacked bar, max 5 segments from the single-hue ramp, labels **on** the segments | Brand mix, category mix, payment-mode mix |
| `<Sparkline>` | 40×16 dp, no axes, no labels, one `petrol.700` stroke | Inside a KPI tile and inside a retailer row |
| `<AgeingBuckets>` | Horizontal stacked bar in the four ageing colours, each segment carrying its ₹ figure at ≥20 sp | Owner phone, retailer ledger, accountant register |

**Axis, label and legend rules:**

- **No legend where direct labelling is possible** — and it almost always is. Label the line at its end, label the segments on the bar. A legend is a lookup task.
- **Money y-axes start at zero**, always. Ticks in lakh/crore via `Intl.NumberFormat('en-IN')` (`₹4.2L`, `₹1.8Cr`), maximum 5 ticks, tabular.
- **X axis is the IST business date** (`businessDate()`), never a timestamp; labelled "4 Sep", with the month shown only on the first tick of a month.
- **Every chart states its range and its "as of" time on the chart itself**, in `field.label` / `desk.label` — not in a tooltip. A chart the owner screenshots for a brand meeting must carry its own provenance.
- **Gridlines:** horizontal only, 1 px `border.hairline`. No vertical gridlines, no plot border, no background fill.
- **Hover degrades to tap-to-reveal on phone.** Tapping a point pins a value label; tapping elsewhere dismisses it. Nothing is hover-only `[UX-02 §3 item 27]`.
- **Empty and sparse are designed states:** fewer than 3 points renders as a labelled value list, not a lonely line. A chart never renders as an empty box.
- No 3D, no shadows, no gradients, no rainbow palettes, no donut past 5 slices, no animated draw-in over 300 ms.

---

## 7. Motion and haptics

### 7.1 Motion budget

Durations and easings are Material 3's published tokens, which remain the safe cross-platform floor `[UX-02 §1.1, §6.1]`.

| class | duration | easing | examples |
| --- | --- | --- | --- |
| Micro-feedback | 50–100 ms | `standard` `cubic-bezier(0.2, 0, 0, 1)` | Press state, checkbox, chip select, stepper bump |
| Element enter / exit | 150–200 ms | in `cubic-bezier(0, 0, 0, 1)`, out `cubic-bezier(0.3, 0, 1, 1)` | Row insert, chip appear, banner, sticky bar shadow |
| Surface / sheet | 250–300 ms | in `cubic-bezier(0.05, 0.7, 0.1, 1)`, out `cubic-bezier(0.3, 0, 0.8, 0.15)` | Bottom sheet, dialog, side panel |
| Screen transition | ≤ 300 ms | the navigator's own | Route push/pop — never re-implemented |

**Rules:**

- **Nothing routine exceeds 300 ms.** No decorative loops, no page-level flourishes, no splash animation.
- **Animate `transform` and `opacity` only.** Never `width`, `height`, `top`, `left`, or anything that triggers layout — that is what drops frames on a 4 GB Android `[UX-02 R14]`.
- **Springs where they earn it** (sheets, the swipe-action snap) using Reanimated with M3's *standard* scheme feel — high damping, minimal overshoot. **We do not use M3 Expressive's low-damping bounce.** A bouncy invoice reads as unserious.
- **Every animation in the kit declares `ReduceMotion.System`.** Reduced motion means **cross-fade or instant, never the same animation slowed down** `[UX-02 R15]`. Web uses `prefers-reduced-motion`. Skeletons go static, the sheet cross-fades, the stepper value swaps without a bump.

### 7.2 Haptics

One façade in `shared-ui/feedback` — `haptics.select()`, `.toggle()`, `.gestureStart()`, `.success()`, `.warning()`, `.error()`, `.destructive()`. **Screens never import `expo-haptics`** `[UX-02 R32]`. Strength scales inversely with frequency `[UX-02 R33]`. On Android, prefer `performAndroidHapticsAsync` with the matching `AndroidHaptics` constant over a generic impact `[UX-02 R34]`.

**The commit map — every commit in this product, its haptic, and its visual success:**

| Commit | App | Haptic | Visual success (the haptic is never the signal) |
| --- | --- | --- | --- |
| Order placed | sales, retailer | `Success` (Android `Confirm`) | Button → "Order placed", order number appears, screen advances to the beat list with the shop marked done |
| Order rejected — credit stop / MOV / over limit | sales | `Error` (Android `Reject`) | Inline `brick` block on the offending line with the amount over and the approval path; nothing is lost |
| Bargain / credit override approved | owner, manager | `Success` | Card animates out of the queue, `moss` "Approved" toast with Undo (4 s) |
| Bargain rejected | owner, manager | `Warning` | Card requires a reason code before it clears; the requester sees the reason `[UX-02 R29]` |
| Gate count committed | warehouse | `Success` | Keypad collapses, the count is echoed at `field.moneyL` beside the invoice's expected count with the variance |
| Barcode / QR decoded | warehouse | `select()` | Chip animates into the scanned stack, running count increments |
| Scan rejected / unknown code | warehouse | `Error` | `brick` banner + the "Type code" button already focused |
| **GRN posted** | warehouse | `Success` | Determinate button progress → GRN number, lot lines listed, "Stock is live for reps" |
| Pick confirmed / pack confirmed | warehouse | `select()` per line, `Success` on the last | Line strikes through; short-packs shown as their own rows beside the original ask, never as edits |
| **Invoice issued** | manager (phone) | `Success` | Determinate progress → invoice number from the series, then the PDF preview |
| Delivery confirmed | delivery | `Success` | Stop card flips to `moss` "Delivered", next stop slides up |
| Partial delivery recorded | delivery | `Warning` | Per-line shortfall summary at `field.moneyL`, credit-note note, then next stop |
| Delivery failed | delivery | `Error` | Reason recorded, `brick` "Failed", the shop's phone number stays one tap away |
| **Payment collected** (cash / UPI / cheque) | delivery, retailer | `Success` | Client receipt number immediately, server number when it lands; running "collected today" increments visibly |
| Settlement variance outside tolerance | delivery, manager | `Warning` | Red variance figure at `field.hero`, reason-code picker, "Needs Sunil's approval to close" |
| **Trip settled / closed** | delivery, manager | `Success` | Trip card moves to Closed with expected vs declared side by side |
| Stepper tick, tab change, segment change | all | `select()` | Value/indicator moves |
| Toggle | all | `toggle()` | Switch moves |
| Long-press opens the pieces keypad | sales, warehouse | `gestureStart()` | Keypad rises |
| Destructive confirm (cancel invoice, void receipt) | all | `destructive()` (`impactAsync(Medium)`) | Dialog's confirm; the record stays visible in a cancelled state |
| **Nothing else.** No haptic on navigation, scroll, keyboard digits, screen load, toast, or pull-to-refresh. | | | Prefer no haptic over a buzzy one `[UX-02 R35]` |

Plus:

- **Setting: Haptics — Full / Important only / Off**, default Full, stored per device `[UX-02 R36]`.
- **On a ₹9,000 Android's rotary actuator, Success and Error feel nearly identical.** The haptic therefore always *confirms a visible state change* and is never the signal itself `[UX-03 D11]`.
- **Web gets no haptics.** The Vibration API on Android Chrome is a buzz, not a haptic.
- **Sound is never required.** Ambient noise on a Kalyan beat is 70–100 dB; audio is off by default and is never a channel `[UX-01 U5]`.

### 7.3 Optimistic UI — where it stops

Optimistic by default for anything the client can validate locally: order lines, check-in, visits, draft edits, delivery outcomes, receipts (with a client receipt number shown immediately).

**Never optimistic — these take a number from a series, write ledgers, and are irreversible:** **issue invoice · post GRN · close trip · approve a credit override.** They get a determinate in-progress button state, double-submit protection via `idempotencyKey` (generated **once per user intent**, never per attempt), the confirmation dialog, and only then the number `[UX-02 §4.8]`, `[UX-03 D3]`.

---

## 8. Layout

### 8.1 Desk shell (owner, manager + accountant)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo] Tarsun Enterprises        [ / search ]      Updated 2 min ago  │  56px, bg.surface, hairline bottom
├────────────┬─────────────────────────────────────────────────────────┤
│ Today      │  Outstanding                              [Export] [⌘P] │  page header: title 24px + actions right
│ Orders     │  ─────────────────────────────────────────────────────  │
│ Billing    │  [ 0–30 ][ 31–60 ][ 61–90 ][ 90+ ]   filters, count      │
│ Money      │  ┌───────────────────────────────────────────────────┐  │
│ Stock      │  │ Retailer ▏ Bills ▏ 0–30 ▏ 31–60 ▏ 61–90 ▏ 90+ ▏…│  │  sticky thead, frozen col 1
│ Reports    │  │ …                                                 │  │  32px rows, 14px cells
│ Settings   │  └───────────────────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────────────────┘
```

- **A collapsible 200 px rail on `bg.surface`, not a fixed dark-navy sidebar.** The navy sidebar in `frontend/owner-app/src/styles.css` (`grid-template-columns: 220px 1fr`, `#0f172a`) is the 2014 admin-template silhouette and is the first thing to delete `[UX-02 §3 item 1]`.
- **Maximum two navigation levels.** Six top-level destinations, each opening on its most likely screen. No three-level trees, no breadcrumb bar, no hamburger on a desktop viewport.
- **Page header carries the title on the left and the actions on the right**, including Export and Print, always visible without scrolling `[UX-01 O6]`.
- Content column max 1200 px, gutter `space.6`. **Every register must fit at 1366×768 without horizontal scroll.**
- **The distributor's name and logo sit top-left, on every screen.** Distribution OS's own mark appears only on sign-in (§3.6).

**Keyboard map — the Tally-habit contract** `[UX-01 O3, O4]`, `[UX-02 R31]`. A distributor's accountant judges this within ten minutes.

| key | action |
| --- | --- |
| `/` | Global go-to — the `Alt+G` analogue. Jumps to any register, retailer, invoice or setting |
| `⌘K` / `Ctrl+K` | Command palette (actions, not navigation) |
| `Tab` / `Shift+Tab` | Walk fields in document order |
| `Enter` | Commit the primary action |
| `Esc` | Cancel / close, one level at a time |
| `↑` `↓` | Move in a list; `Enter` opens |
| `j` / `k` | Move in an approval queue |
| `1` / `2` / `3` | Approve / Reject / Ask, in a queue |
| `⌘P` | Print the current register to A4 |
| `?` | Shortcut overlay |

Every shortcut is **printed on its own button** as well as listed in `?` — Tally users learn shortcuts by seeing them `[UX-01 O4]`.
**Numeric entry never re-sorts or re-filters under the cursor and never jumps focus** — that is the classic web-app failure against Tally `[UX-01 O5]`.

### 8.2 Phone shell (sales, warehouse, delivery, retailer; and the desk apps' phone surfaces)

```
┌────────────────────────────┐  ← insets.top; edge-to-edge is mandatory on Android 16
│ [logo] Tarsun    ●●●       │  header 56dp — INFORMATION ONLY, no primary action
│ Updated 2 min ago          │  connection strip, 28dp, non-blocking
├────────────────────────────┤
│                            │
│   content — opens on the   │  the top third is read, not touched
│   most likely next action  │
│                            │
│   … scrolls …              │
│                            │
├────────────────────────────┤
│  [   Place order  ₹18,420 ]│  primary action, 64dp, bottom third
└────────────────────────────┘  ← + insets.bottom, always
```

- **Every screen composes from `react-native-safe-area-context` insets from the first frame.** Android 16 / targetSdk 36 is required by Google Play from 31 August 2026 and **cannot opt out of edge-to-edge**; predictive back is on by default. A hard-coded `paddingTop: 24` is a bug that surfaces on someone's phone in Kalyan `[UX-03 §14a]`.
- **Sticky bottom action bars add `insets.bottom`** or the primary action sits under the gesture pill.
- **The one-handed rule:** every primary flow completes with one right thumb without a grip change. 49% of users are one-handed, 75% of interactions are thumb-driven, 67% right thumb `[UX-01 U9]`. The bottom third is the action zone; **the top of the screen carries information only**.
- **Nothing destructive lives in the bottom bar or under the resting thumb** `[UX-01 U10]`. Fail delivery, cancel, void: a deliberate second action, 50 dp away from the safe one.
- **Tab bar, not a drawer** — maximum 4 tabs, real labels, no truncation. A drawer hides the app from a user who was trained in ten minutes. `sales` and `warehouse` get 4 tabs; `delivery` and `retailer` get **no tab bar at all** — those apps are a single stack that opens on the next stop / the last bill.
- **Every screen opens on its most likely next action**, never on a menu or a filter form: today's beat, the next stop, the GRN queue, "Order again" `[UX-02 R28]`, `[docs/08]`.
- **Two screens are designed to be physically turned around and shown to the shopkeeper** — the order confirmation and the disputed-quantity screen. Single column, no horizontal scroll, every figure ≥20 sp, legible at arm's length across a counter. These end the two most common daily arguments `[UX-01 S8, D5]`.

### 8.3 Performance is a layout constraint

Budgets, on the reference device (a bought ~₹9,000 4 GB Android) over throttled 4G, checked in CI `[UX-01 U11–U13]`, `[UX-03 §13]`:

cold launch ≤ 1.5 s · time to first render ≤ 2.0 s · time to interactive ≤ 3.0 s · every tap acknowledged ≤ 100 ms · list scroll ≥ 55 fps median · web initial route ≤ 600 KB gz (field) / 900 KB gz (desk) · Android download ≤ 30 MB · a full working day ≤ 10 MB of data · user-perceived ANR ≤ 0.2% DAU.

Two design consequences that belong here rather than in a technical doc: **a list cell does zero derivation** (§6.6), and **ePOD/invoice photos are compressed client-side to ≤1600 px / ~200 KB before upload**, with compression and queued upload shown as a normal state rather than an error — uploading a 12 MP photo over rural 4G is the most likely cause of "the delivery app is stuck" `[UX-03 §13]`.

---

## 9. Writing

English only for now, and the flow must survive a user who reads no English sentence `[UX-01 U15]`.

**The five rules:**

1. **Use the trade's own word, not the software's word.** These people have had a vocabulary for forty years.
2. **A label is ≤20 characters.** A button is verb + object. A sentence never carries a flow.
3. **Never abbreviate money or a count.** "₹1,24,500", not "₹1.2L", except on a chart axis.
4. **State the next action, not the problem.** "Ask Sunil to approve?" beats "Credit limit exceeded."
5. **No exclamation marks, no "Oops", no "Great job", no emoji anywhere in the product.**

**The word list** — left column banned, right column shipped:

| Never say | Say |
| --- | --- |
| COGS, cost of goods sold | **Purchase cost** |
| Accounts receivable, AR | **Outstanding** |
| Aging | **Ageing** — and the buckets read "0–30 days", not "Bucket 1" |
| SKU | **Item** (the product name the retailer uses) |
| ATP, available-to-promise | **Available** |
| MOV | **Minimum order** |
| FOC, free-of-cost | **Free** |
| PTR / PTD / landing price | **Retailer rate** / **Your rate** / **Landed cost** |
| POD, ePOD | **Delivery proof** |
| PJP | **Beat plan** |
| PCR, strike rate | **Shops that ordered** (and "6 of 11 ordered") |
| DSO | **Average days to pay** |
| FEFO | **Oldest expiry first** |
| SLOB | **Slow moving** |
| Sync, queue, idempotency | **Waiting to send** |
| Tenant, organisation | the distributor's own business name |
| Submit, OK, Done, Save (for a commit) | **Place order · Post GRN · Issue invoice · Confirm delivery · Record payment · Close trip** |
| Error 4xx, "Something went wrong" | the business reason and the next action |

**Keep** the words the trade actually uses and would be insulted to see explained: **beat, scheme, case, pieces, MRP, GRN, LR, credit note, invoice, godown, claim, batch, expiry**. Write "Goods receipt (GRN)" the first time it appears in a screen title, then "GRN" everywhere else.

**Dates and numbers:** IST always; the business date (`businessDate()`), never a timestamp, for anything a ledger uses. "Today", "Yesterday", then "4 Sep" — never a relative date beyond 7 days, never "3 weeks ago" on a bill. Times as "9:40 am". Indian digit grouping everywhere.

**Person and tone:** address the user directly ("Your beat today"), refer to money in the third person ("₹18,420 outstanding"), and never make the app the subject ("We couldn't…" → "Not sent yet — waiting for signal").

---

## 10. What we will NOT do

The named list. A screen is walked against this before its module is called stable, and the starred items are **already in the repo and must be deleted** `[UX-02 §3]`.

**Structure and chrome**

1. ★ A dark-navy fixed sidebar with a white content pane (`frontend/owner-app/src/styles.css`).
2. ★ Bootstrap blue `#1d4ed8` with a flat nine-hex palette and no tonal ramp (`frontend/libs/ui/src/tokens.ts`).
3. Border **and** shadow **and** radius on the same element; cards inside cards; panels inside panels.
4. A breadcrumb bar, a centred page title, or a row of outlined buttons at top-right.
5. Three-level nav trees; a hamburger on a desktop viewport.
6. A bottom tab bar with 5+ tabs, or truncated tab labels.
7. A splash screen with a big logo.
8. A dashboard that opens blank until you pick a date range and a filter.

**Visual language**

9. Neumorphism, multi-stop gradients, glassmorphism sprayed across surfaces.
10. Emoji as iconography; mixed icon sets; inconsistent stroke weights. One icon set, 1.75 px stroke, 24 dp grid.
11. ALL-CAPS wide-tracked section labels.
12. A FAB on every screen whether or not there is one primary action.
13. Skeuomorphic paper-invoice textures, rupee-note motifs, photographic headers.
14. Illustrations in empty states.
15. A pill-shaped primary button.
16. Dark mode auto-selected from system appearance on any field app.

**Data and numbers**

17. Proportional numerals in a money column; `₹` at the same weight as the amount; inconsistent decimal precision down a column.
18. A desktop table shrunk onto a phone — horizontal scroll, no frozen column, no card view.
19. `<input type="number">` for money.
20. Status shown by colour alone; a bare coloured dot with no word.
21. 3D bars, drop-shadowed charts, rainbow palettes, a nine-slice donut, a chart with no stated date range.
22. A list cell that computes anything.

**Interaction**

23. A "Sync now" button, or "Refresh" as the primary path to current data.
24. A full-screen blocking modal for sync, GPS, connectivity or permission; `alert()`; `window.confirm()`.
25. A centred spinner as the loading state for a list whose shape we know.
26. A success toast after every action; toasts as the record of what happened.
27. A confirmation dialog in front of every destructive action instead of undo for the reversible ones.
28. Routine transitions at 400–600 ms; decorative page-level animation.
29. Hover-only affordances with no touch equivalent.
30. Swipe-to-complete, slide-to-confirm, drag-to-reorder — anywhere, and *especially* nowhere in the delivery app.
31. A geo-fence that blocks work. A permission prompt on app open. A registration form in front of a retailer.
32. Losing a half-typed order to a phone call.

Items 31 and 32 are the two that decide whether this product is adopted at all.

---

## 11. Per-app character

**Owner (:3001) — the instrument panel.** Desk-primary, phone-secondary, and the only app that may run dark. On the phone it answers four questions with zero taps — collected today, cash in transit, outstanding by ageing bucket, what needs approval — with rupee outcomes at `field.hero` and percentages secondary `[UX-01 O1]`. At the desk it is graphs and registers: this is where the founder's growth charts live, and where the profit view lives as an owner-only route that is never bundled into another role's app `[UX-01 O10]`. Character: calm, dense, numerate, no chrome. The owner is the only user who is ever *browsing*; everyone else is executing.

**Manager + accountant (:3002) — the keyboard loop.** The highest-repetition surface in the product: 60–120 invoices a day, select → review → issue → next, with the hand never leaving the keyboard and a visible count of what remains `[UX-01 M1]`. Ageing, credit block and the reason are stated in one line *at the point of billing*, never discovered after the invoice is issued `[UX-01 M4]`. GST screens show days-to-deadline against **the 11th** (GSTR-1) as the primary date, because liability has been hard-locked in GSTR-3B since July 2025 and corrections must land in GSTR-1A first — the accountant's real deadline is nine days earlier than the roadmap assumes `[UX-01 §6.3]`. The phone surface is confirm-and-photograph only: any flow needing more than one typed number belongs on the desk `[UX-01 M2]`. Character: fast, terse, printable.

**Sales (:3003) — ninety seconds in a doorway.** He is standing in the 60 cm between the counter and the sacks, one hand holding a sample, the shopkeeper serving a customer, six to twelve minutes of which the app may claim ninety seconds `[UX-01 §2.1]`. So: repeat order in **3 taps** from a cold open, a modified order in ≤15 taps and ≤60 seconds, measured in a Maestro flow and failing CI if it regresses `[UX-01 S1]`. The shop card opens with outstanding, ageing and last order above the fold. Geo-tag is an amber chip with a distance, never a gate. **The bundle contains no cost UI at all** — a routing guarantee, verified by the CI role-leak dump `[UX-01 S9]`. The draft persists within 500 ms of every keystroke and restores to the exact cursor with no "resume?" prompt, because losing an order to a phone call is *the* signature failure of this category `[UX-01 S4]`. Character: big, fast, forgiving, one-thumbed.

**Warehouse (:3004) — put it down, pick it up.** 76 dp targets, because the hand is dusty, damp and hurried. The phone lives on a carton and is used for eight seconds at a time, so **every count, line confirmation and photo persists the instant it is made — there is no Save step that can be lost** `[UX-01 W4]`. The gate count is a full-screen keypad at 44 sp with nothing else on screen, and it stays **typed**: the camera must never quietly become the counter, or the "zero manual entry except the gate count" promise breaks in the wrong direction `[UX-03 D10]`. Every scan screen carries an equally prominent "Type code" button at the same size in the same thumb zone, and a torch toggle whose state survives the session `[UX-01 W3, W10]`. Case and pieces always together. Character: loud, literal, indestructible.

**Delivery (:3005) — one hand, and the other one has cash in it.** Three buttons in the bottom third — Deliver, Partial, Failed — with 50 dp between the safe pair and the failing one. A clean delivery in ≤3 taps, ≤5 with collection `[UX-01 D3]`. **No swipes, no slide-to-confirm, no drag anywhere**, because for four months a year the screen and the finger are wet `[UX-01 D9]`. Nothing requires interaction while the vehicle moves — phone use while driving is prosecuted under MV Act §184 `[UX-01 D1]`. The photo never blocks; the stop closes and the upload queues. The expected cash is shown above the input and never pre-filled into it. Everything survives a dead battery mid-trip. Character: three big buttons and a number.

**Retailer (:3006) — the detail view for a WhatsApp message.** He is behind a counter, serving a customer every 40 seconds. He **never fills a registration form**: he arrives from a WhatsApp deep link already identified, and the first screen is his outstanding or his last order — no signup, no tour, no permission prompt, no push/location/contacts permission ever `[UX-01 R1, R8]`. Reorder in 2 taps, first meaningful paint ≤2.5 s. The outstanding screen is shaped like his physical pending-bills file: one row per bill, oldest first, ageing as colour + icon + word, ₹ at ≥24 sp, the distributor's own UPI QR one tap away on every bill `[UX-01 R7]`. One card per linked distributor, never a merged catalogue or a blended balance. Every important outcome also arrives on WhatsApp, because the app is not a destination he remembers to open `[UX-01 R9]`. Character: two screens, no words, his own shop's name at the top and the distributor's name — never ours.

---

## 12. Open questions for the founder

Ten minutes of decisions that unblock the token file and the first screens. Each has my recommendation; say yes or say otherwise.

1. **The product name.** You asked me to create one. The mark in §3.6 works with any of these — pick one and I will draw it: **(a) keep "Distribution OS"** (accurate, a little technical, hard to say in Marathi); **(b) "Vitran"** — वितरण, *distribution*, one word, unmistakably Indian, owns the category word in the language of the market; **(c) "Ledger"** — what it actually is to the owner, but crowded internationally. **My recommendation: (b).** It is the only one a distributor's brother-in-law can repeat after hearing it once, and this product spreads by word of mouth between distributors.
2. **The accent colour.** §3 is built on petrol `#0B5A63` — verified at 7.90:1 for white text, unclaimed in Indian distribution software, and it sits calmly next to any distributor's logo. Approve it or name a colour and I will re-derive the whole system around it (it is a two-hour job, not a redesign, because everything is token-driven).
3. **White-label scope.** I have decided that the distributor supplies **name and logo only, never a colour** (§3.6) — because a tenant-controlled accent destroys every contrast guarantee in §3. Confirm. If you want per-tenant colour, we ship a fixed set of five pre-verified accents to choose from, never a colour picker.
4. **Print and PDF branding.** Every generated document (invoice, statement, delivery challan, credit note) carries the distributor's name, logo, GSTIN, FSSAI and UPI QR, and **no Distribution OS mark anywhere on it**. Confirm — it is the difference between a tool the distributor is proud to hand a retailer and one he is embarrassed by.
5. **WhatsApp sender identity.** When a bill reaches a retailer, does it come from *Tarsun Enterprises* (recommended — matches the white-label rule and is what the retailer will recognise) or from a shared Distribution OS number? This decides the WABA setup and cannot be changed cheaply later.
6. **Dark mode: ship it in v1 or v2?** Field apps never get it (§3). For owner and accountant it is real work — a second set of chart colours, a second set of screenshots, a second review pass. **My recommendation: define the tokens now (done, §3.2), ship the toggle in v2**, so nothing is redesigned later.
7. **App icons.** Six apps means six icons in one launcher, and a rider must find his in one glance. **Recommendation: one shared silhouette in `petrol.700`, differentiated by a single white glyph** — shop, box, van, cart, chart, ledger. Confirm, or say you want six distinct marks.
8. **Haptics default.** Full / Important only / Off, defaulting to **Full**. A rider on a bike and an accountant at a desk want different answers, so it is a per-device setting either way. Confirm the default.
9. **The reference device.** Nothing in §8.3 is real until it is measured on one bought handset. **Buy one ~₹9,000 4 GB Android and, separately, measure the actual screen brightness of Tarsun's staff handsets** — the 450–600 nit figure behind the whole contrast argument is inferred from the segment, not measured `[UX-01 §9]`.
10. **Two numbers to confirm on the ground before they are frozen:** time one of Tarsun's reps on a real beat (the 90-second budget behind the 3-tap rule is derived, not observed), and spend an hour in the godown confirming that loaders work bare-handed `[UX-01 §9]`.

---

## 13. How this is enforced

A design system that is only a document is a document. These are machine-checked.

| Check | Where |
| --- | --- |
| No hex literal outside `shared-ui/tokens.ts` | ESLint |
| No `expo-haptics` import outside `shared-ui/feedback` | ESLint `no-restricted-imports` |
| No chart-library import outside `shared-ui/charts` | ESLint |
| No `react-native` primitive import in a screen except `View` | ESLint |
| No animation without a `ReduceMotion` argument | ESLint |
| No `type="number"` | ESLint |
| `.web.tsx` count in owner + manager ≤ 18 | CI script |
| No cost string in the sales, delivery or retailer bundle | existing role-leak dump, extended to the app bundles |
| Cold start, TTI, bundle size, web gzip | CI on the reference device + Expo Atlas |
| Tap-count budgets: 3-tap reorder, ≤3-tap delivery, 2-tap retailer reorder | Maestro flows, fail on regression |
| Screenshots on the ₹9,000 4 GB Android **and** an iPhone, light (and dark for desk), at 100% and 200% system font | required before a module is called stable |
| The §10 list, walked screen by screen | design review, per module |

---

## Sources

**Repo (the three research documents this one decides on top of)**
`docs/design/UX-01-field-reality.md` · `docs/design/UX-02-current-standards.md` · `docs/design/UX-03-technical-constraints.md` · `docs/01-positioning-and-standout-features.md` · `docs/02-five-apps-and-surfaces.md` · `docs/06-order-to-cash-flows.md` · `docs/08-frontend-architecture.md` · `docs/17-corrections-from-review.md` §D · `docs/18-build-log.md` · `docs/domain/operational-pain-points.md` · `docs/domain/glossary.md` · `docs/plans/reporting.md` · `frontend/owner-app/src/styles.css` · `frontend/libs/ui/src/tokens.ts`

**Verified first-hand for this document (font binaries inspected with fontTools 4.60.2 on 2026-09-04)**
- IBM Plex Sans (Google Fonts variable `IBMPlexSans[wdth,wght].ttf`): digit advance 600/1000 upem at Regular, SemiBold and Bold — tabular by default, no `tnum` feature present or required; `₹` U+20B9 present. https://github.com/IBM/plex · https://fonts.google.com/specimen/IBM+Plex+Sans
- IBM Plex Sans Devanagari: same 1000 upem, same 600-unit digit advance, `₹` and Devanagari present. https://fonts.google.com/specimen/IBM+Plex+Sans+Devanagari
- Inter (Google Fonts variable `Inter[opsz,wght].ttf`): digit advances 833–1323/2048 upem — proportional by default; `tnum` feature present. https://fonts.google.com/specimen/Inter
- All contrast ratios in §3 computed to WCAG 2.x relative luminance.

**External**
- Expo — Fonts (variable fonts unsupported on native; use static): https://docs.expo.dev/develop/user-interface/fonts/
- React Native — `fontVariant` Android support since 0.62: https://github.com/facebook/react-native/pull/27006
- W3C WCAG 2.2 — 1.4.6 Contrast (Enhanced), 2.5.8 Target Size: https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html
- ISO/TS 9241-411:2012 — touch target sizing: https://cdn.standards.iteh.ai/samples/54106/cf35f99b4eb94bfe871f4b71b524c2c0/ISO-TS-9241-411-2012.pdf
- Material 3 — motion easing and duration tokens: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
- Android — haptics design principles: https://developer.android.com/develop/ui/views/haptics/haptics-principles
- Apple HIG — Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Reanimated — `useReducedMotion` / `ReduceMotion.System`: https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/
- Expo — edge-to-edge on Android (targetSdk 36 from 31 Aug 2026): https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
- EAS Observe — launch/TTR/TTI metric budgets: https://docs.expo.dev/eas/observe/reference/metrics/
- Android Developers — OkCredit case study (60% ANR reduction → +22% D1 retention on low-end devices): https://developer.android.com/stories/apps/okcredit
- Smashing Magazine / Hoober — thumb zone and 11–12 mm target sizes: https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/
- Shopify Polaris tokens — semantic-alias-over-primitive model: https://github.com/Shopify/polaris-tokens/blob/main/CHANGELOG.md
