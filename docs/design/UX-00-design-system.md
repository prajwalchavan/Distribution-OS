# UX-00 — The Distribution OS design system (direction A, "Ledger")

**Status:** final. The founder chose layout **A Ledger** on 2026-09-05 (`docs/22-source-of-truth.md` §8) for all six apps. This document
is the contract every screen is built against; a screen is not "stable" until it passes §16.
**Supersedes** the 2026-09-04 proposal (same file), the styling rows of `docs/08-frontend-architecture.md`, and the placeholder palette in
`frontend/libs/ui/src/tokens.ts` (`#1d4ed8`, `minTarget: 48`) and `frontend/owner-app/src/styles.css` (navy sidebar) — both are deleted when
the first screen lands.
**Built on:** `UX-01-field-reality.md` (what the body and the environment permit), `UX-02-current-standards.md` (what 2026 looks like),
`UX-03-technical-constraints.md` (what the stack allows) and `docs/design/layout-options.html` (the four directions; A is the pick). Where this
document and those disagree, this one wins. Evidence is cited inline as `[UX-01 U6]`, `[UX-02 R21]`, `[UX-03 D5]`.

Nothing here is optional. Every number is a number, every colour is a hex, every rule is checkable in review. Every contrast ratio below was
computed (WCAG 2.x relative luminance), not estimated. `docs/23-app-screens-and-api-gaps.md` is the binding screen inventory (`docs/22` §8,
2026-09-05); §9.0 maps every screen id in it to a navigation destination and to the components of §6, and §9.1–§9.6 work one screen per app.

## 1. Direction A in one paragraph

**A well-kept accounts book that answers instantly.** A warm off-white page, near-black ink, thin rules instead of boxes, and one deep teal for
anything you can act on. Dense and quiet; nothing decorative anywhere; colour appears only when it means something (green paid, amber due, red
overdue). It feels like the ledger it replaces, so staff trust it on sight, it shows the most numbers per screen of the four directions, and it
ages slowly. The cost, accepted by the founder: it is deliberately plain and will never make anyone say "wow" in a demo. Everything below is A
tightened into tokens, plus the evidence-based rules that A does not contradict. Where A's sketch and an evidence rule conflict, §3.6 says
which wins and why.

**The five properties a reviewer checks first:** (1) ground is `paper.100`, surfaces are white, and no card, row, strip, table, chip or input
carries a shadow (the four elevations are in §5.4); (2) groups are
separated by hairlines, never by boxes-inside-boxes; (3) the only saturated colour that is not a status is petrol; (4) KPIs are columns of a
register strip, not tiles; (5) charts are 2 px lines on hairline gridlines with no fills.

## 2. Six apps, two densities, one system

Six apps, one per role; the manager and the accountant share one (`docs/22` §2). Each app talks only to its own service.
`docs/02-five-apps-and-surfaces.md` still carries the old "two store binaries plus one web console" verdict; that verdict is
superseded by `docs/22` §2 and this document. There are **two densities, not two design systems**: every token in §3–§5 is identical on both; what changes is grid density,
navigation model and primary input.

|                | **Desk** — owner (:3001), manager + accountant (:3002)          | **Field** — sales (:3003), warehouse (:3004), delivery (:3005), retailer (:3006)                                                                                            |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary device | PC at 1366×768 `[UX-01 O8]`; phone secondary                    | 4 GB / 720p / 4G Android, 5.5–6.6", and its iPhone equivalent `[UX-01 §1.4]`                                                                                                |
| Primary input  | Keyboard; no action needs a pointer `[UX-01 O3]`                | One right thumb; no action needs two hands `[UX-01 S2]`                                                                                                                     |
| Density        | 32 px register rows, 14 px cells, 20 px gutters (§4.3)          | 72–96 dp rows, 16 sp body, 16 dp gutters                                                                                                                                    |
| Theme          | Light default; dark tokens defined, shipped in v2               | **Light only**; never reads system appearance `[UX-01 U1]`                                                                                                                  |
| Touch floor    | 24×24 CSS px (WCAG 2.2 SC 2.5.8) — it is a mouse; buttons 32 px | The one sentence in §5.2: **69 dp in sales, delivery, retailer; 76 dp for every warehouse target and the delivery stop actions; 63 dp on the owner/manager phone surfaces** |
| Primary action | Page-header right, plus `Enter`                                 | Bottom third, above `insets.bottom` `[UX-01 U9]`                                                                                                                            |
| Tables         | Real `<table>`: sticky head, frozen first column, `⌘P`          | Grouped list cards. **Never a table** `[UX-02 R20]`                                                                                                                         |

**Platform** `[UX-03 D1]`: all six are Expo Router apps; owner and manager declare `web` primary and fork only dense leaves to DOM
(`Register.web.tsx` = TanStack Table, `Register.native.tsx` = FlashList of rows). Route tree, tokens, money logic, session and query layer are
never forked. Fork budget: **18 `.web.tsx` files across owner + manager**, counted in CI. Every desk screen is designed twice, on purpose, at
both densities in the same pass. **Parity:** Android and iOS render the same layout from the same tokens; only navigation transitions, back
behaviour, keyboards, pickers and share/print sheets are the platform's own `[UX-02 R9]`.

**Density forks by app class and viewport, never by platform.** A field app's web build — the retailer's shipping artefact `[UX-03 D1]`, a
manager covering a beat — gets the field tokens, field sizes and field components on every target and never loads a desk component (a field app
has no `.web.tsx` fork; UX-03 D1 calls one a design smell). A desk app rendered at a phone-width viewport (< 768 px) gets the phone shell of
§8.2. So the right-hand column above also covers "field app, web target, phone viewport"; §6.7 and §6.12 name the phone-web renderings.

## 3. Colour

### 3.0 How colour works here

- Colours exist **only as semantic tokens** generated from private primitive ramps. No screen writes a hex (lint) `[UX-02 R1]`.
- **One accent.** Petrol is the action and the selected state, nothing else. Status hues are a separate family `[UX-02 R2]`.
- **Colour is never the only channel.** Every state is colour + icon + word `[UX-01 U3]`.
- **Every text pair in a field app is ≥ 7:1.** A 450–600 nit panel under 80,000 lux has no headroom to spend `[UX-01 U2]`.
- **Dark mode is a desk feature** (v2); field apps never call `useColorScheme()` `[UX-01 U1, O9]`.

### 3.1 Primitive ramps (private — never referenced by a screen)

**`paper`** — the warm neutral of direction A. Ink is A's `#1B1E1A` (warm-black), not a cool slate.

| token       | hex       | token       | hex       | token       | hex                 |
| ----------- | --------- | ----------- | --------- | ----------- | ------------------- |
| `paper.0`   | `#FFFFFF` | `paper.300` | `#D5D6CF` | `paper.700` | `#4B4F49`           |
| `paper.50`  | `#F8F8F6` | `paper.400` | `#B3B5AC` | `paper.800` | `#3F433D`           |
| `paper.100` | `#F2F2EF` | `paper.500` | `#8E9188` | `paper.900` | `#2A2D28`           |
| `paper.200` | `#EAEAE5` | `paper.600` | `#6A6E66` | `paper.950` | `#1B1E1A` **(ink)** |

**`petrol`** — the accent A was drawn in. Dark enough for white text at AAA, nowhere near red/amber/green, unclaimed in Indian distribution
software (saffron, red, Bootstrap blue), and calm beside any distributor's logo.

| token        | hex       | token        | hex       | token           | hex                                    |
| ------------ | --------- | ------------ | --------- | --------------- | -------------------------------------- |
| `petrol.50`  | `#EBF3F4` | `petrol.300` | `#7FB3B8` | `petrol.700`    | `#0B5A63`                              |
| `petrol.100` | `#D6E7E9` | `petrol.500` | `#3E8E97` | `petrol.800`    | `#07454C`                              |
| `petrol.200` | `#B7CFD1` | `petrol.600` | `#0E6E78` | `petrol.onDark` | `#5FC7D2` (dark surfaces only, 9.13:1) |

**Status hues** — each has a tint (fills), an edge (bar fills, ≥ 3:1 on white), a fg (text ≥ 7:1 on its tint), and an on-dark tone.

| family                   | `.tint`   | `.edge`   | `.fg`     | fg on tint | `.onDark` |
| ------------------------ | --------- | --------- | --------- | ---------- | --------- |
| `moss` — positive        | `#E8F4EA` | `#4E9270` | `#0F5B2E` | 7.26:1     | `#6FD08F` |
| `ochre` — caution        | `#FDF4E3` | `#A8832F` | `#6E4200` | 7.87:1     | `#E8B44F` |
| `clay` — the 31–60 rung  | `#FBEDE0` | `#A05C1F` | `#7C3A08` | 7.42:1     | `#E09A5C` |
| `brick` — critical       | `#FDEFED` | `#BE6A63` | `#9E1C1C` | 7.11:1     | `#F08A82` |
| `neutral` — no judgement | `#EAEAE5` | `#6A6E66` | `#3F433D` | 8.36:1     | `#B9BEB9` |

(A's sketch drew clay text as `#8A4008` = 6.49:1 on its tint; the 7:1 rule pulls it to `#7C3A08`. The bar fill stays `#A05C1F` as drawn.
`neutral.edge` is `paper.600`, not `paper.500`: `#8E9188` inside its own tint is 2.65:1 and the 8–15 bar vanished. Every `.edge` is now ≥ 3:1
on its tint — moss 3.27, ochre 3.23, clay 4.52, brick 3.45, neutral 4.31 — so a bar's width is always readable.)

**`slate`** — dark desk surfaces (v2): `slate.950 #14161A` · `slate.900 #1B1E22` · `slate.800 #20252A` · `slate.700 #2B2F33` · `slate.500 #6E767F`.

### 3.2 Semantic tokens (this is what screens use)

| token                                                              | light                  | dark (desk, v2) | ratio (light)                                                                        |
| ------------------------------------------------------------------ | ---------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `bg.ground` — the page                                             | `paper.100` `#F2F2EF`  | `slate.950`     | —                                                                                    |
| `bg.surface` — rail, header, cards, rows, sheets, bottom bar       | `paper.0` `#FFFFFF`    | `slate.900`     | —                                                                                    |
| `bg.raised` — hover, menus, popovers                               | `paper.50` `#F8F8F6`   | `slate.800`     | —                                                                                    |
| `bg.sunken` — wells, segmented track, chart plot area, avatars     | `paper.200` `#EAEAE5`  | `slate.950`     | never under text in a field app                                                      |
| `bg.skeleton` — loading placeholders (§6.13)                       | `paper.200` `#EAEAE5`  | `slate.800`     | decorative                                                                           |
| `bg.handle` — the bottom-sheet handle                              | `paper.400` `#B3B5AC`  | `slate.500`     | decorative                                                                           |
| `text.primary`                                                     | `paper.950` `#1B1E1A`  | `#ECEDE8`       | **16.84:1** surface · 15.01:1 ground                                                 |
| `text.secondary`                                                   | `paper.700` `#4B4F49`  | `#B9BEB9`       | **8.35:1** surface · 7.45:1 ground                                                   |
| `text.tertiary` — **desk only**; sublines, eyebrows, axis text     | `paper.600` `#6A6E66`  | `#9AA096`       | 5.20:1 surface · 4.64:1 ground (AA, not AAA)                                         |
| `text.disabled` — disabled labels and values, on `bg.surface` only | `paper.700` `#4B4F49`  | `#9AA096`       | **8.35:1** surface (state is carried by the outline + reason line, never by greying) |
| `icon.muted` — empty-state and placeholder glyphs                  | `paper.600` `#6A6E66`  | `#9AA096`       | 4.64:1 ground (graphic, needs 3:1)                                                   |
| `text.onAccent` / `text.onSolid`                                   | `#FFFFFF`              | `slate.950`     | see accent rows                                                                      |
| `border.hairline` — section rules, header/rail edges, baseline     | `paper.300` `#D5D6CF`  | `slate.700`     | 1.46:1 (decorative)                                                                  |
| `border.faint` — row dividers, KPI column dividers, gridlines      | `paper.200` `#EAEAE5`  | `slate.800`     | 1.21:1 (decorative)                                                                  |
| `border.strong` — inputs, unchecked boxes, frozen-column edge      | `paper.500` `#8E9188`  | `slate.500`     | **3.20:1**                                                                           |
| `accent.fg` — links, active nav/tab label, scheme text             | `petrol.700` `#0B5A63` | `petrol.onDark` | **7.90:1** surface · 7.05 ground · 7.02 tint                                         |
| `accent.solid` — any fill carrying text or a glyph                 | `petrol.700` `#0B5A63` | `petrol.onDark` | white on it **7.90:1**                                                               |
| `accent.pressed`                                                   | `petrol.800` `#07454C` | `#7FD6DF`       | white on it 10.69:1                                                                  |
| `accent.line` — chart series, 3 px indicators, end dot             | `petrol.600` `#0E6E78` | `petrol.onDark` | 5.32:1 on ground (graphic, needs 3:1)                                                |
| `accent.tint` — active nav item, selected row, scheme row          | `petrol.50` `#EBF3F4`  | `#123037`       | secondary text on it 7.42:1                                                          |
| `focus.ring`                                                       | `petrol.700`           | `petrol.onDark` | 2 px ring, 2 px offset, 1 px `bg.surface` halo                                       |

`text.secondary` on `bg.sunken` is 6.92:1 and `paper.500` on it is 2.65:1: no text ever sits in a well in a field app, and **a disabled
control is never greyed** — it keeps `bg.surface`, takes a `border.strong` outline, sets its label in `text.disabled` (8.35:1) and prints the
reason line beneath in `text.secondary` (§6.1, §6.2). The loader reading "Confirm 14 lines" under a tin roof gets the same contrast as any
other word on the screen.

### 3.3 Domain semantics — the colours that mean something here

Rendered as a `StatusChip` (§6.9): **tint fill, `.fg` text, 16 dp icon, the word; `radius.xs`; no border** (as drawn in A). The `solid`
variant (white on `.fg`, 7.96:1 for brick) is reserved for the three states that must read across a godown: **Out of stock, Overdue, Failed.**

| domain                                                           | state → family · word on screen                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock (`sellable_stock`)                                         | In stock → `moss` "In stock" · Low → `ochre` "Low · 4 cs" · Out → `brick` **solid** "Out of stock" · Not carried → `neutral` "Not stocked"                                                                                                              |
| Invoice money state                                              | Paid → `moss` · Part paid → `ochre` "Part paid · ₹4,200 left" · Due → `neutral` "Due 12 Sep" · Overdue → `brick` **solid** "Overdue · 14 days" · Cancelled / written off → `neutral`, struck                                                            |
| Delivery outcome (set only at the stop, with proof `[UX-01 R6]`) | Delivered → `moss` · Partial → `ochre` "Partial · 2 of 6 short" · Failed → `brick` **solid** "Failed · shop shut" · Not yet → `neutral` "Stop 4 of 11"                                                                                                  |
| Approval                                                         | Approved → `moss` "Approved by Sunil · 10:42" · Pending → `ochre` "Waiting for owner" · Rejected → `brick` "Rejected — over credit limit" (reason always shown `[UX-02 R29]`)                                                                           |
| Connection (§6.11)                                               | Synced → no fill, `text.secondary` "Updated 2 min ago" · Waiting → `ochre` "3 orders waiting" · Offline → `neutral` + struck cloud "Offline since 10:42" · Stale > 4 h → `ochre` "Stock as of 9:40 am" · Needs attention → `brick`, the business reason |

**Ageing** is the six-bucket ladder of `docs/22` §6 (which wins over the four buckets in the 2026-09-04 draft and over the four rows A
sketched). It is one ordered ladder, always the same colours in the same order — in chips, in the `BarLadder`, and as register column heads:

| bucket     | tint                        | bar / edge | text      | reads as                  |
| ---------- | --------------------------- | ---------- | --------- | ------------------------- |
| 0–7 days   | `#E8F4EA`                   | `#4E9270`  | `#0F5B2E` | fresh (moss)              |
| 8–15 days  | `#EAEAE5`                   | `#6A6E66`  | `#3F433D` | within terms (neutral)    |
| 16–30 days | `#FDF4E3`                   | `#A8832F`  | `#6E4200` | past terms (ochre)        |
| 31–60 days | `#FBEDE0`                   | `#A05C1F`  | `#7C3A08` | chase (clay)              |
| 61–90 days | `#FDEFED`                   | `#BE6A63`  | `#9E1C1C` | escalate (brick)          |
| 90+ days   | `#9E1C1C` solid, white text | —          | `#FFFFFF` | stop credit (brick solid) |

**Ageing counts from the invoice date** (`docs/22` §6: the bucket is "days since the bill was raised"); "Overdue · N days" on a chip is a
different number — days past the due date — and a screen never mixes the two in one phrase.

### 3.4 Chart colour (as drawn in A, with the marks that failed 3:1 re-inked)

- **Primary series:** `accent.line` 2 px (5.32:1 on ground), round joins, a 3 px dot on the last point only. **Second measure on the same
  chart** (collections beside sales): `ochre.edge` `#A8832F` 2 px, dashed `3 3` (3.15:1 on ground). **Previous period:** `paper.600` `#6A6E66`
  2 px, dashed `6 3` (4.64:1 on ground — A drew it in `paper.400`, 1.85:1, and the comparison that makes a growth chart a growth chart was the
  faintest mark on it). **Target:** `paper.700` 1 px dashed `2 2` (7.45:1). Every chart mark meets WCAG 1.4.11's 3:1 on `bg.ground`.
- **Categorical mix** (brand, category, payment mode): single-hue ramp `petrol.700 → 500 → 300 → 200`, then `paper.700` for "Other". Max five
  slices; adjacent steps 1.42–2.08:1 apart, colour-blind-safe by construction. **No text sits on a segment**: `petrol.500` takes neither white
  (3.80:1) nor ink (4.43:1), so segment labels live in the key line beneath the bar (§6.14); segments are separated by 1 px of `bg.surface`.
- **Charts whose subject is a status** (ageing, delivery outcomes, approval age) use §3.3 and nothing else.
- Gridlines `border.faint` 1 px horizontal; baseline `border.hairline`; no area fill, no gradient, no 3D, no shadow, no plot border.

### 3.5 Colour rules a reviewer can check

1. A colour not in §3.2–§3.4 fails the screen. 2. A state legible only by hue fails. 3. Field-app text below 7:1 fails; `text.tertiary` is
   banned from sales, warehouse, delivery and retailer. 4. `border.hairline`/`border.faint` never mark an interactive boundary —
   inputs and checkboxes use `border.strong`. 5. No surface carries a shadow except the four in §5.4; cards never nest in cards.

### 3.6 Where A and the evidence disagreed, and which won

| A's sketch showed                                                                   | Evidence rule                                                                                       | Winner and why                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button and `+` fills in `#0E6E78` (white on it 5.97:1)                              | 7:1 for field text `[UX-01 U2]`                                                                     | **Evidence.** Text-bearing fills use `petrol.700` (7.90:1); `#0E6E78` survives as `accent.line`.                                                                                                                        |
| Phone sublines in `#6A6E66` (5.20:1)                                                | 7:1 in the field                                                                                    | **Evidence.** Field sublines use `text.secondary` `#4B4F49`; the warm-grey character is unchanged.                                                                                                                      |
| Ink `#1B1E1A` (draft had `#15181B`)                                                 | none                                                                                                | **A.** Warmer ink, 16.84:1.                                                                                                                                                                                             |
| Rail group label "SETUP" in `#8E9188` (3.20:1)                                      | WCAG AA text floor 4.5:1 (desk)                                                                     | **Evidence.** It is set in `text.tertiary` `#6A6E66` (5.20:1); `paper.500` stays a border colour.                                                                                                                       |
| Uppercase tracked eyebrows ("SALES", "USUAL ORDER", "SETUP")                        | Draft banned all-caps tracked labels `[UX-02 §3 item 11]`                                           | **A, narrowly.** Eyebrows only (§4.4): ≤ 14 characters, tracking 0.06 em, never a column head, nav item or button.                                                                                                      |
| Status chips: 4 px radius, tint only, no border                                     | Draft: pill + 1 px edge "visible in sunlight"                                                       | **A.** The 7:1 word carries the state, so nothing evidence-based is lost; the edge colour still fills bars.                                                                                                             |
| 38 px steppers, 50 px button (sketch drawn at ~0.83×)                               | 69 dp / 76 dp targets `[UX-01 U6, W1]`                                                              | **Evidence.** Composition and hierarchy as drawn; sizes from §4.2 and §6.                                                                                                                                               |
| Set in Inter for the browser sketch                                                 | Tabular digits by default, Devanagari sibling `[UX-02 R4]`                                          | **Evidence: IBM Plex Sans** (§4.1) at A's sizes and weights; character preserved, digits align structurally.                                                                                                            |
| Four ageing rows                                                                    | `docs/22` §6: six buckets                                                                           | **`docs/22`** — it is the source of truth.                                                                                                                                                                              |
| Ageing colours: 8–15 in ochre, 16–30 in clay, 31+ bar in `#9E1C1C`                  | Six buckets need six steps in one ordered ladder                                                    | **Evidence.** 8–15 → neutral, 16–30 → ochre, 31–60 → clay, 61–90 → brick edge `#BE6A63`, 90+ → brick solid; A's hues survive, one rung lower each.                                                                      |
| Stepper `−` outlined in `#D5D6CF` (`border.hairline`)                               | Rule §3.5(4): hairlines never mark an interactive boundary                                          | **Evidence.** `−` takes `border.strong` `#8E9188` (3.20:1); the `+` fill is unchanged.                                                                                                                                  |
| Desk text at 13 px (cells, nav), 11.5 px (sublines), 10.5 px (eyebrows); 30 px rows | `[UX-01 U8]` "never below 14 sp for any legible content"; `[UX-01 O8]` "32 px rows with 14 px text" | **Evidence.** Every desk text token is 14 px (§4.3); rows are 32 px. One exception is kept and flagged in §14: the 12 px uppercase eyebrow, whose cap height (8.6 px) exceeds the x-height of 14 px lowercase (7.4 px). |
| Legend row under a two-series chart                                                 | Draft: "no legend where direct labels work"                                                         | **A** on desk (one line, 14×2 px swatches). Single-series charts carry no legend; phone labels the line end.                                                                                                            |
| Previous-period series in `#B3B5AC`; 8–15 bar in `#8E9188`                          | WCAG 1.4.11 non-text 3:1 (§3.4)                                                                     | **Evidence.** Previous period `paper.600` dashed; `neutral.edge` = `paper.600`; the ladder keeps A's shape.                                                                                                             |

## 4. Typography

### 4.1 One family: IBM Plex Sans

> **Shipped 2026-09-06:** the binaries are in the repo at `frontend/libs/ui/assets/fonts` (OFL-1.1, licence beside them):
> four static weights, 400 Regular / 500 Medium / 600 SemiBold / 700 Bold, as `.woff2` for the web and `.ttf` for the phone
> builds — static rather than the variable face because the type scale carries exactly those four weights. Each app copies the
> woff2 into its own `public/fonts` through `scripts/sync-fonts.mjs` before `web`, `build` and `export:web`, and `FONT_CSS` in
> `@dos/ui/web` emits one `@font-face` per weight against `/fonts`. The phone half still renders in the platform UI face:
> registering the TTFs through the `expo-font` plugin is verified by the first field app's gate, because an unresolved family
> name on Android silently breaks `fontWeight`.

Reasons are measured (font binaries inspected with fontTools 4.60.2): Plex digits advance 600/1000 at every weight — **tabular by default, no
`tnum` flag that can silently fail on a 4 GB Android**; `₹` present; IBM Plex Sans Devanagari is a sibling with the identical digit advance, so
the later Marathi pass is a font swap, not a redesign `[UX-01 U15]`. A's sketch was set in Inter only because it was a browser artifact; at the
same sizes and weights the character is the same. **Native:** four static weights — 400, 500, 600, 700 — embedded via the `expo-font` plugin
(≈ 240 KB); no italics anywhere. **Web:** self-hosted variable `IBMPlexSans[wdth,wght].ttf`, `font-display: swap`. **Stack:** `'IBM Plex Sans',
system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. No second family, no monospace.

### 4.2 Type scale — field (sp; 1 sp = 1 dp). Body floor 16, money floor 20, nothing below 14 `[UX-01 U8]`

| token              | size / line / weight | tracking  | use                                                                                |
| ------------------ | -------------------- | --------- | ---------------------------------------------------------------------------------- |
| `field.keypad`     | 44 / 52 / 600        | −0.02 em  | Gate-count and cash-collected digits; nothing else on that screen `[UX-01 W2, D6]` |
| `field.hero`       | 32 / 38 / 700        | −0.02 em  | The one number the screen exists for: "You owe", "To collect", trip variance       |
| `field.moneyL`     | 24 / 30 / 700        | −0.02 em  | Order/invoice total, per-bill outstanding, disputed-quantity screen `[UX-01 D5]`   |
| `field.moneyM`     | 20 / 26 / 600        | 0         | Line totals, MRP, rate, quantities, every money value in a row                     |
| `field.title`      | 20 / 26 / 700        | −0.015 em | Screen title, shop name, section heading (A's 19 px title, scaled)                 |
| `field.body`       | 16 / 22 / 400        | 0         | Everything readable                                                                |
| `field.bodyStrong` | 16 / 22 / 600        | 0         | Item name in a row, chip word, button label                                        |
| `field.label`      | 14 / 18 / 500        | 0         | Labels, context line ("Station Road · stop 7 of 18"), timestamps. Never a figure   |
| `field.eyebrow`    | 14 / 18 / 600        | +0.06 em  | UPPERCASE group heading ("USUAL ORDER"), `text.secondary`, ≤ 14 characters         |

**What "figure" means** `[UX-01 U8]`: any money value, any stock or order quantity (cases, pieces, "Available 40 cs"), any case-size line
("1 cs = 24 pc · = 48 pc"), and any count a decision rests on ("31 of 36 shops") is set in `field.moneyM` or larger — in rows, on chips
(§6.9), under steppers (§6.4), in charts (§6.14). Dates, times, document numbers ("GL/1642"), and positions ("stop 7 of 18") are labels and
may sit in `field.label`. A reviewer reads every number on a field screen against this sentence.

### 4.3 Type scale — desk (px). Floor 14 px `[UX-01 U8, O8]`; A's 13/11.5/10.5 px density is recorded and overruled in §3.6

| token            | size / line / weight       | tracking  | use                                                                                                              |
| ---------------- | -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `desk.kpi`       | 24 / 28 / 700              | −0.02 em  | Register-strip value                                                                                             |
| `desk.pageTitle` | 20 / 26 / 700              | −0.015 em | Page header ("Today", "Orders")                                                                                  |
| `desk.railTitle` | 14 / 18 / 700              | −0.01 em  | The distributor's display name in the rail head (§8.1, §11)                                                      |
| `desk.section`   | 14 / 20 / 600              | 0         | Panel heading ("Sales & collections · 14 days", "Needs you")                                                     |
| `desk.body`      | 14 / 20 / 400              | 0         | Prose, form values, side-panel text                                                                              |
| `desk.nav`       | 14 / 20 / 400 (600 active) | 0         | Rail items                                                                                                       |
| `desk.cell`      | 14 / 20 / 400              | 0         | Register cell text; rows **32 px** (`[UX-01 O8]`: "32 px rows with 14 px text")                                  |
| `desk.cellMoney` | 14 / 20 / 500              | 0         | Register money cell — right-aligned, two decimals                                                                |
| `desk.label`     | 14 / 18 / 500              | 0         | Column heads (sentence case), field labels, `text.secondary`                                                     |
| `desk.meta`      | 14 / 18 / 400              | 0         | Sublines, deltas, axis ticks, timestamps, `text.tertiary` (colour, not size, sets it apart)                      |
| `desk.eyebrow`   | 12 / 16 / 600              | +0.06 em  | UPPERCASE strip labels ("SALES") and the rail group label, `text.tertiary` — the one sub-14 token (§3.6, §14 q8) |

### 4.4 Eyebrows — the one uppercase allowed

A's character comes partly from small tracked capitals over each figure. They are allowed **only** as: register-strip labels, phone group
headings, and the rail's group label ("SETUP"). ≤ 14 characters, tracking 0.06 em, never wider. Column heads stay **sentence case, medium,
`text.secondary`**; nav items, buttons, chips and titles are never uppercase.

### 4.5 The number rules

1. **Every number is tabular** (the typeface guarantees it; `<Money>` and `<Qty>` also set `fontVariant: ['tabular-nums']`).
2. **Integer paise in, integer paise out**: `<Money value={paise} />`, `<RupeeInput onChange={paise => …} />`. No float enters a component.
3. **Indian grouping, always:** `₹1,24,500.00` via `Intl.NumberFormat('en-IN')` with the `@dos/domain` lakh/crore fallback `[UX-02 R24]`.
4. **Hero money is composed, column money is not.** In a hero (strip value, invoice total, "To collect") `₹` and paise sit at 0.72 em, one
   weight lighter, `text.secondary`; the integer carries full size. In any column every glyph is the same size and weight, right-aligned.
5. **₹ once per column.** A register or ladder states `₹` in its head; rows carry digits only (as A drew "5,12,300"). Rows in a list, chips
   and heroes always carry `₹`.
6. **Fixed precision down a column** — two decimals, even `.00`; a column mixing precisions is the loudest amateur tell.
7. **Quantity is dual-unit and never toggled:** `2 cs + 6 pc = 186 pc`; case size from `tenant_products.case_size_override` else
   `product_variants.default_case_size` `[UX-01 W5, S3]`.
8. **Dynamic type:** text scales freely; numeric text carries `maxFontSizeMultiplier={1.3}`; every row wraps to two lines at 200% without
   clipping; `allowFontScaling={false}` is banned `[UX-03 §14b]`.
9. **Screen readers get words:** every `<Money>` sets `accessibilityLabel={speakMoney(paise)}` `[UX-03 §14c]`.
10. **Label budget 20 characters**, one string catalogue per app `[UX-02 R8]`.

## 5. Space, touch, shape, elevation

### 5.1 Spacing

One 4 px scale: `space.1 = 4 · 2 = 8 · 3 = 12 · 4 = 16 · 5 = 20 · 6 = 24 · 8 = 32 · 10 = 40 · 12 = 48`. Field gutter `space.4`; desk main
padding `space.5` (20 px) all round (A drew 18/20; 20 is the nearest scale step); desk content max 1200 px. Inside a group: `space.3`
label→value, `space.4` between rows' content, `space.6` between sections.

### 5.2 Touch floors — the one sentence every size in §6 obeys

**Every tap target is ≥ 69 dp (11 mm) in sales, delivery and retailer; ≥ 76 dp (12 mm) on every warehouse screen and for the delivery stop
actions (Delivered / Partial / Failed); ≥ 63 dp (10 mm) on the owner and manager phone surfaces; ≥ 24 px on desk, where buttons are 32 px**
`[UX-01 U6, W1, D2]`. Gaps between adjacent targets ≥ 19 dp (3 mm), **≥ 25 dp (4 mm) on every warehouse screen** `[UX-01 W1]`, and ≥ 50 dp
(8 mm) between a confirming and a destructive action. §2 quotes this sentence; no component states a different floor. The four `size` tokens
that carry it: **`field` 69 · `floor` 76 · `phone` 63 · `desk` 32**; each app's shell fixes which one applies (sales, retailer → `field`;
warehouse → `floor` everywhere; delivery → `floor` for the stop actions, `field` elsewhere; owner and manager phone → `phone`).
Material's 48 dp (7.6 mm) and Apple's 44 pt are below the floor and are not our minimum. A visible element smaller than its floor (a 24 dp
chip, a 28 dp strip) is never tappable; the tappable thing is always the full-height row, button or cell that contains it.

### 5.3 Radii and borders

**Radii (A is tighter than the draft):** `radius.xs = 4` (status chips, tags) · `radius.sm = 6` (inputs, steppers, rail items, filter chips)
· `radius.md = 8` (buttons, group cards, register outline) · `radius.lg = 12` (dialogs, side panels) · `radius.xl = 20` (bottom-sheet top
corners) · `radius.full` (avatars only). A primary button is `radius.md`, never a pill.

**Borders:** `border.hairline` for rules that structure a page (rail edge, header bottom, page-header rule, chart baseline, totals rule);
`border.faint` for rules inside a group (row dividers, strip column dividers, gridlines, the group-card outline); `border.strong` for anything
interactive or state-bearing. A group is one box with faint hairlines inside; a row is never its own box. **Focus ring** (desk and web): 2 px
`focus.ring` outline, 2 px offset, 1 px `bg.surface` halo; restore `:focus-visible` in the generated `tokens.css` because RN Web strips it.

### 5.4 Elevation — exactly four things, nothing else

Bottom sheet `0 -2px 16px rgba(27,30,26,.12)` · dialog `0 8px 32px rgba(27,30,26,.16)` · sticky bottom bar **only while content scrolls
under it** `0 -1px 8px rgba(27,30,26,.08)`, 150 ms · menus/popovers `0 4px 16px rgba(27,30,26,.12)`. Cards, rows, strips, tables, chips and
inputs are flat. On dark, elevation is lightness (`950 → 900 → 800`), never shadow. No translucency/"glass" behind text `[UX-02 §1.2]`.

## 6. Components (contracts)

The shared library is `frontend/libs/ui` (`shared-ui`). A screen imports from `shared-ui`, `@dos/domain` and `@dos/contracts` only — never
`react-native` primitives except `View`, never `expo-haptics`, never a chart library (ESLint `no-restricted-imports`) `[UX-03 §15]`.
**Universal press rule: every tap changes something visible within one frame (≤ 100 ms)** `[UX-02 R19]`.

### 6.1 `<Button>`

| variant       | fill                               | text           | use                                                                        |
| ------------- | ---------------------------------- | -------------- | -------------------------------------------------------------------------- |
| `primary`     | `accent.solid`                     | white          | The one commit on the screen. One per screen.                              |
| `secondary`   | `bg.surface` + `border.strong`     | `text.primary` | Alternatives: "Add item", "Type code", "Short"                             |
| `ghost`       | none                               | `accent.fg`    | Row and header actions: "Open", "Export"                                   |
| `destructive` | `bg.surface` + `brick.edge` border | `brick.fg`     | Fail delivery, cancel invoice, void receipt. **Never a solid red button.** |

Props: `label` (verb + object, ≤ 20 chars), `size: 'field' | 'floor' | 'phone' | 'desk'` → heights **69 / 76 / 63 dp / 32 px** (§5.2; the
app's shell sets the default, a screen never picks a smaller one); `icon?`, `shortcut?` (printed on the button on desk), `disabledReason?`
(required whenever `disabled`). States: `default` · `pressed` (`accent.pressed`, scale 0.98, 80 ms) · `disabled` (**`bg.surface`, 1 px
`border.strong` outline, label in `text.disabled` 8.35:1, reason line beneath in `text.secondary` — never a grey fill, never a grey word**) ·
`loading` (label stays, 16 dp determinate spinner in the icon slot, width unchanged, re-taps swallowed by `idempotencyKey`) · `success`
(200 ms: label → outcome word + check). Full-width on phone, auto-width on desk. Never "Submit", "OK", "Done" or "Save" for a ledger write
(§13). A `destructive` press whose write is irreversible opens the §6.12 dialog; a reversible one gets undo.

### 6.2 `<TextInput>`

Label above in `field.label`/`desk.label` (never a floating placeholder); input ≥ 16 sp (iOS Safari zooms below 16 px); `border.strong` 1 px,
`radius.sm`, **tall as the app's touch floor — 69 dp `field`, 76 dp `floor`, 63 dp `phone`, 32 px `desk`** (§5.2); helper line with reserved
height. States: `default` · `focused` (focus ring) · `filled` · `disabled` (`bg.surface`, 1 px dashed `border.strong`, value in `text.disabled`)
· `readonly` (no outline, selectable) · `error` (`brick.edge` outline + `brick.fg` message: the business problem and the next action) ·
`validating` (14 dp spinner in the trailing slot, never a blocked field). Never `<input type="number">` `[UX-02 R21]`.

### 6.3 `<Money>` and `<RupeeInput>`

`<Money value size="hero|moneyL|moneyM|cell" tone?="positive|critical|secondary" />`. `<RupeeInput value onChange bound?>`: **field apps open a
full-screen `<NumberPad>`** (`field.keypad` digits, 76 dp keys, formatted preview on top, Clear, Done); desk is a text field with
`inputMode="decimal"`. `₹` is a fixed visible prefix; format on blur; accepts `1234`, `1,234`, `1234.5` → emits paise. **No silent
clamping:** over a bound, the value is accepted and the screen says what happens — "₹12,400 over limit. Needs Sunil's approval." Cash
collection shows the expected amount **above** the pad and never pre-fills it `[UX-01 D6]`.

### 6.4 `<QtyStepper>` — the most-used control

`−` and `+` at **69 dp (76 dp warehouse)**, `radius.sm`, `space.3` (12 dp; 25 dp in warehouse) between them; `−` is `bg.surface` +
`border.strong`; `+` is `accent.solid` with a white glyph (as A drew it); value between them in `field.moneyM`; beneath, the case line
`2 cs = 48 pc · 40 cs available` in **`field.moneyM`** — it is a figure (§4.2). Steps by case; **long-press opens the pieces pad, and a visible
"Pieces" button does the same** `[UX-01 U7]`. Defaults to the shop's last quantity. States: `default` · `stepping` (selection haptic per tick,
80 ms value bump) · `atZero` (`−` disabled, row reads "Not ordered") · `overAvailable` (`ochre` "Only 14 cs available — rest short-supplied",
accepted) · `blocked` (`brick`, reason + approval path) · `disabled`. The availability figure comes from `sellable_stock` on every row
`[UX-01 R4]`; the applied scheme prints in rupees on the row as a 28 dp `accent.tint` chip in `field.moneyM` (20 sp, above S8's 16 sp floor).

### 6.5 `<Search>`

Local-first, debounced 200 ms against the on-device catalogue; results under the field, never an overlay; first result reachable by thumb.
States: `idle` (recent + last-ordered for this shop, never blank) · `typing` (no spinner under 300 ms) · `noResults` (query echoed + "Add as
new item" where allowed) · `error` (cached results shown with their age). Desk: `/` focuses search anywhere; `⌘K` opens the command palette.

### 6.6 `<ListRow>` and `<Group>`

A `<Group>` is A's line card: `bg.surface`, 1 px `border.faint` outline, `radius.md`, an optional footer strip (`accent.tint`, `accent.fg` text
— the scheme row). Rows inside are separated by `border.faint`; a row is 72–96 dp, `space.4` padding: **leading slot** (icon / avatar /
checkbox, 40 dp) · **primary** (`field.bodyStrong`) · **secondary** (`field.label`, `text.secondary`, one line — never a figure) · **trailing
stack, right-aligned** (money in `trailingSize: 'moneyM' | 'moneyL'`, default `moneyM`; the retailer's bills use `moneyL` `[UX-01 R7]`; over a
`StatusChip`). **A row does zero derivation** — ageing, totals and formatting arrive pre-computed from the service `[UX-03 D6]`. States:
`default` · `pressed` (`bg.raised`, 80 ms) · `selected` (`accent.tint` + 3 px `accent.line` leading bar) · `waiting` (`ochre` clock glyph) ·
`needsAttention` (`brick` leading bar + reason). Swipe actions are accelerators only, never destructive, always with a tap equivalent; **the
delivery app has none** `[UX-01 D9]`. The whole row is the tap target (≥ 72 dp, above every floor in §5.2).

**`<OrderLineRow>`** — the sales and retailer order editors' row; not a `<ListRow>`, because a 69 dp stepper and three 20 sp figures do not
fit in 96 dp. Two states, one row `editing` at a time. **`collapsed`** (80 dp, tap anywhere to edit): item name `field.bodyStrong`; beneath
it `2 cs + 0 pc = 48 pc` `field.moneyM`; trailing: line total `field.moneyM` over the scheme chip (28 dp, `accent.tint`, `field.moneyM`
"−₹68 · 1 free per 10") when a scheme applies `[UX-01 S8]`, else the availability chip. **`editing`** (≈ 183 dp; 219 dp with a scheme chip):
`space.3` padding; L1 name + line total (26); L2 `₹34.00/pc · 24 pc case` `field.moneyM` (26); `space.2`; the `<QtyStepper>` (69); `space.1`;
L3 `2 cs = 48 pc · 40 cs available` `field.moneyM` (26); the scheme chip row (28 + `space.2`) when present. The editing row scrolls to sit
directly above the bottom bar so the stepper is under the thumb. **Visible on the reference phone** (content area 278 dp at 360×640 with the
§8.2 chrome, 438 dp at 360×800): 3 collapsed rows, or 1 editing + 1 collapsed, at 640; 5 collapsed, or 1 editing + 3 collapsed, at 800. The
group footer carries only the order-level scheme total; the per-line scheme is on the line. Tap budget for S1 still holds: reorder (2) + 5 lines
× (expand + one step) + Place order = 13 ≤ 15.

### 6.7 `<Register>` — the ledger, on desk and on phone

One props contract (`columns`, `rows`, `frozen`, `totals`, `onSelect`, `export`), two renderings `[UX-03 D6]`.

**Desk (a desk app at ≥ 768 px):** real `<table>` on TanStack Table. Head row: `desk.label` sentence case, `border.hairline` beneath. Body rows
**32 px**, `desk.cell`, `border.faint` between rows, **no zebra**, no vertical rules except the frozen first column's `border.strong` edge.
Money columns right-aligned `desk.cellMoney`; `₹` in the head. Totals row: `border.hairline` above, weight 600. Hover `bg.raised`; selected
`accent.tint`; keyboard `↑ ↓ Enter`. TanStack Virtual past 200 rows. Sticky head, `⌘P` print stylesheet, text selection, right-click. **Every
register fits a typical month at 1366×768 without horizontal scroll, and Export + Print sit in the page header without scrolling** `[UX-01 O6,
O8]`. **Phone (native, or any phone-width viewport, or any field app's web build):** a `FlashList` (a `ScrollView` on web) of `<Group>`ed
`<ListRow>`s in column-priority order — identity, the one number, a chip; the rest one tap away. The `<table>` rendering never appears in a
field app. States: `loading` (skeleton) · `empty` · `error` · `partial` ("as of" chip) · `filtered` (chip row naming the filters, one-tap clear).

### 6.8 `<KpiStrip>` and `<BarLadder>` — A's two signature panels

**`<KpiStrip items={[{label, value, delta?, tone?}]} />`** — 2–4 columns in one row, **no cards**: columns divided by `border.faint`, the strip
closed by `border.hairline` above and below. Each column: `desk.eyebrow` label, `desk.kpi` value (`field.hero` on phone, stacked 2×2), a
`desk.meta` delta in `moss.fg` / `brick.fg` / `text.tertiary`. On phone, `field.eyebrow` + `field.hero` + a `field.moneyM` delta (it carries
a figure, §4.2). **`<BarLadder rows={[{label, value, tone}]} />`** — one row per rung: label 40 px `text.tertiary` (`field.label`
`text.secondary` in the field), a 16 px track in the rung's tint, fill in the rung's edge colour (every edge ≥ 3:1 on its tint, §3.1), width
∝ value, value right-aligned 600 tabular (`field.moneyM` in the field); `₹` in the panel title. Used for the ageing ladder and any "by bucket"
figure. Every rung carries its number even at 0. `docs/23` calls the ageing instance `<AgeingBuckets>`; that is `<BarLadder>` with the §3.3 rungs.

### 6.9 `<StatusChip>`

`radius.xs`, `space.2` horizontal padding, tint fill, `.fg` text, 16 dp icon, the word. **Word-only chips** ("In stock", "Delivered", "Waiting
for owner"): `field.bodyStrong`/`desk.label`, 24 dp tall (28 dp warehouse). **A chip that carries a figure** ("Owes ₹18,400", "Low · 4 cs",
"Only 14 cs available", "Overdue · 14 days", "−₹68 · 1 free per 10"): the whole chip in `field.moneyM`, 28 dp tall (32 dp warehouse) `[UX-01
U8]`; the two heights share a row on the baseline. `solid` variant for the three loud states only. Never a bare dot; never colour without the
word. A chip is information, never a tap target (§5.2).

### 6.10 Tabs, chips, segments

Tabs: ≤ 4, label + count ("Pending 4"), 3 px `accent.line` underline, 150 ms, never a scrolling strip in a field app; each tab is the full
height of its bar. Filter chips: `radius.sm`, `border.strong` unselected → `accent.tint` + check when selected, **tall as the app's touch floor
(69 / 76 / 63 dp; 32 px desk)**, ≥ 19 dp apart (25 dp warehouse); a filter row never leaves the screen without a "3 filters" summary.
Segmented control (2–3 options): the same floor height, `bg.sunken` track, `bg.surface` thumb with a faint hairline; native `@expo/ui`
control where better `[UX-03 D9]`.

### 6.11 `<ConnectionStrip>` — the honesty contract

One persistent, **non-blocking** strip on every screen of every app — under the header on phone, in the rail foot on the desk shell (§8.1) —
from `useConnection() → { online, lastSyncedAt, pendingWrites }`: "Updated 2 min ago" · "3 orders waiting" (`ochre`) · "Offline since 10:42".
**Sizes:** 28 dp and not tappable while it has nothing to open; when `pendingWrites > 0` or a needs-attention item exists it becomes a
full-width tappable row at the app's touch floor (69 / 76 dp) whose tap opens the waiting list — never a send button. **No "Sync now", no
"Refresh" as the path to current data, never a modal for sync, GPS, permission or connectivity** `[UX-01 U16]`, `[UX-02 R25, R27]`. Over 4 h
stale → `ochre` with the time ("Stock as of 9:40 am"); cached prices on the order screen are labelled. Online-first now; when offline lands
for sales and delivery before the pilot, only the source of `pendingWrites` changes — no screen changes.

### 6.12 `<Sheet>`, `<Dialog>`, `<Toast>`

**Bottom sheet on every phone-width surface, whatever the platform:** native `@gorhom/bottom-sheet` v5; on the web at < 768 px (the retailer's
shipping build, a field app in a browser) a `<dialog>` docked to the bottom edge with the same geometry. Both: `radius.xl` top corners, 32×4 dp
`bg.handle`, backdrop `rgba(27,30,26,.32)`, a visible Close, `insets.bottom` respected. **Desk apps at ≥ 768 px** use a focus-trapped dialog or
a right-hand side panel (360 px, `bg.surface`, `border.hairline` left) `[UX-03 D8]`. **Dialogs exist for irreversible ledger writes only**, and
for all of them: issue invoice · post GRN · close (settle) a trip · approve a credit override · cancel an issued invoice · reverse or void a
receipt · record a cheque bounce · write off a bill · cancel a confirmed order (`cancelled` is terminal and releases the reservation). Each
states exactly what will be written ("Invoice GL/1688 · ₹18,420 · stock leaves Kalyan godown") with the real verb on the confirm `[UX-02 R26]`.
**Undo is reserved for what the machines can actually reverse**: draft lines and quantities, check-ins and visit marks, filters, bulk
selection, a not-yet-submitted draft — a 4 s toast, one at a time, above the action bar, `bg.raised`, ≤ 6 words, **the toast is the app's
touch-floor height (69 / 76 dp) and Undo is a full-height button ≥ 88 dp wide**, no haptic, never the record of an event.

### 6.13 `<Avatar>`, `<TenantLogo>`, `<EmptyState>`, `<ErrorState>`, `<Skeleton>`

Avatar: initials in `field.bodyStrong` `text.primary` on `bg.sunken` (15.01:1), `radius.full`, 40 dp rows / 32 dp headers; no photographs, no
identity rings. `<TenantLogo>` is specified in §11. EmptyState: 32 dp `icon.muted` icon, one line ≤ 8 words, a `secondary` button naming the
next thing ("No stops left — close the trip") `[UX-01 U15]`. ErrorState: business language + next action; a `sync_errors` row becomes a
**"Needs attention" work item in the list**, never an error screen `[UX-02 R30]`; codes live behind "Details". Loading: < 300 ms nothing ·
300 ms–1 s an inline indicator · > 1 s a content-shaped skeleton in `bg.skeleton` at real row heights, 1.2 s pulse, static under reduce-motion;
never a full-screen spinner on a known-shape screen; every visited screen repaints from the persisted query cache first `[UX-02 R16, R17]`.

### 6.14 The chart set (`shared-ui/charts`)

One props contract; `.native.tsx` on `react-native-svg` + `d3-scale`/`d3-shape`, `.web.tsx` on Recharts; scales, tick formatters, the IST
business-date axis and the ramp live in `@dos/domain` `[UX-03 D5]`.

**These five names are the whole chart vocabulary** — in this file, in UX-03 D5 and in `docs/23` (whose `<AgeingBuckets>` is `<BarLadder>`).

| component       | shape (A)                                                                                                                                                            | where                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `<TrendChart>`  | 1–2 lines, **12–92 points** (12 = an FY at month grain, 92 = the day-grain cap), 2 px, hairline gridlines, end dot, first/last/month-start ticks, legend if 2 series | Owner growth and performance (O2), collections, outstanding, ageing history; sales rep's 30-day line (S9) |
| `<CompareBars>` | Grouped bars, current `accent.line` vs previous `paper.600`, ≤ 12 groups, 2 px gap, square corners                                                                   | Month by month, brand-wise, beat-wise, rep-wise                                                           |
| `<StackedMix>`  | One horizontal 100% bar, ≤ 5 segments, 1 px `bg.surface` gaps, **labels in a key line beneath** (swatch · name · value · %) — never on a segment (§3.4)              | Brand / category / payment-mode mix                                                                       |
| `<Sparkline>`   | 40×16 dp, one `accent.line` stroke, no axes                                                                                                                          | Inside a strip column or a retailer row (O1, O6)                                                          |
| `<BarLadder>`   | §6.8                                                                                                                                                                 | Ageing everywhere (O1, O10, S2, R3); delivery outcomes                                                    |

Rules: money axes start at zero; ≤ 5 ticks in lakh/crore (`₹4.2L`); x axis is the IST business date ("4 Sep"); every chart prints its range and
"as of" time on itself — in `desk.meta` on desk, in **`field.label` `text.secondary`** in a field app (axis ticks, range, as-of; `text.tertiary`
never enters the field, §3.5); hover degrades to tap-to-pin on phone; fewer than 3 points renders as a labelled value list; no draw-in over
300 ms. The retailer app draws only the ageing `<BarLadder>` from `receivables.outstanding.get.buckets`; reporting is not mounted on
retailer-service, so there is no retailer `<TrendChart>` (`docs/23` §6.2).

## 7. Motion and haptics

| class          | duration   | easing (M3 tokens)                                   | examples                                   |
| -------------- | ---------- | ---------------------------------------------------- | ------------------------------------------ |
| Micro-feedback | 50–100 ms  | `cubic-bezier(0.2, 0, 0, 1)`                         | Press, checkbox, chip, stepper bump        |
| Enter / exit   | 150–200 ms | in `(0, 0, 0, 1)` · out `(0.3, 0, 1, 1)`             | Row insert, chip, strip, sticky-bar shadow |
| Surface        | 250–300 ms | in `(0.05, 0.7, 0.1, 1)` · out `(0.3, 0, 0.8, 0.15)` | Sheet, dialog, side panel                  |
| Screen         | ≤ 300 ms   | the navigator's own                                  | Route push/pop — never re-implemented      |

Animate `transform` and `opacity` only `[UX-02 R14]`; springs only on sheets, high damping, no M3-Expressive bounce; every animation declares
`ReduceMotion.System` — reduced motion means cross-fade or instant `[UX-02 R15]`; nothing routine exceeds 300 ms; no splash animation.

**Haptics** — one façade `haptics.select() · toggle() · gestureStart() · success() · warning() · error() · destructive()`; screens never import
`expo-haptics` `[UX-02 R32]`; strength scales inversely with frequency; Android uses `performAndroidHapticsAsync` constants `[UX-02 R33, R34]`.
Setting **Full / Important only / Off**, default Full, per device. **Web has none** `[UX-02 R36]` — so the retailer app, whose shipping
artefact is web `[UX-03 D1]`, is visual-only until its native build ships; the table below names it for that later build. Sound is never a
channel `[UX-01 U5]`. On a ₹9,000 actuator Success and Error feel alike, so **the haptic always confirms a visible state change and is never
the signal** `[UX-03 D11]`.

| action class                                                                                                                                                                         | haptic                        | visual success (the record)                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------- |
| Order placed (sales; retailer native only) · payment collected (delivery; retailer native only) · delivery confirmed · GRN posted · invoice issued · trip settled · approval granted | `success` (Android `Confirm`) | Button → outcome word; the number from the series appears; screen advances |
| Partial delivery · bargain rejected · settlement variance · over-available quantity                                                                                                  | `warning`                     | Inline `ochre` statement with the figure and the next action               |
| Order blocked (credit stop, minimum order) · scan rejected · delivery failed                                                                                                         | `error` (Android `Reject`)    | Inline `brick` block on the offending line; nothing is lost                |
| Stepper tick · tab / segment change · barcode decoded · pick line confirmed                                                                                                          | `select`                      | Value / indicator moves; chip animates into the scanned stack              |
| Toggle                                                                                                                                                                               | `toggle`                      | Switch moves                                                               |
| Long-press opens the pieces pad                                                                                                                                                      | `gestureStart`                | Pad rises                                                                  |
| Destructive confirm (cancel invoice, void receipt)                                                                                                                                   | `destructive`                 | Record stays visible in its cancelled state                                |
| Navigation, scroll, keypad digits, screen load, toast, pull-to-refresh                                                                                                               | **none**                      | `[UX-02 R35]`                                                              |

**Optimistic UI** for what the client can validate locally (order lines, check-in, visits, drafts, submit to `submitted` with a waiting mark,
delivery outcomes, receipts with a client receipt number) `[UX-02 §4.8]`. **Never optimistic, and never undoable:** confirm an order (the
authoritative stock check, `docs/22` §4; `confirmed` leads only to `start_picking` or `cancel`) · issue invoice · post GRN · close trip ·
approve a credit override · cancel an invoice · reverse a receipt · bounce · write-off · cancel a confirmed order — determinate progress on
the button, one `idempotencyKey` per user intent, the §6.12 dialog where the write is irreversible, then the number `[UX-03 D3]`.

## 8. Layout

### 8.1 Desk shell (owner; manager + accountant) — A's composition

```
┌ rail 172 px, bg.surface, hairline right ┬─ main: bg.ground, padding 20, max 1200 px ─────────────────────────────────┐
│ [logo 28] Tarsun Enterprises railTitle  │ Today                                     Thu 3 Sep 2026   [Export] [Print ⌘P] │ page header: title 20/700,
│           Kalyan · FY 2026-27  desk.meta│ ───────────────────────────────────────────────────────────────────── hairline │ actions right, hairline under
│ ─────────────────── faint ───────────── │ SALES        │ COLLECTED    │ OUTSTANDING   │ FILL RATE                          │ KpiStrip (§6.8)
│ Today            ← active: accent.tint  │ ₹1,84,200    │ ₹1,41,500    │ ₹8,62,400     │ 96.2%                              │
│ Orders             + accent.fg, 600     │ ▲ 12% vs Thu │ 2 trips active│ ₹94,100 overdue│ 4 short lines                    │
│ Billing            desk.nav 14 px, 32 px│ ─────────────────────────────────────────────────────────────────── hairline   │
│ Money              rows, radius.sm      │ panels: 1.55fr 1fr, gap 20; headings desk.section; content on the ground,       │
│ Stock                                   │ no card — a panel is a heading, a hairline and its content                     │
│ Shops                                   │                                                                                 │
│ Reports                                 │                                                                                 │
│ SETUP            ← desk.eyebrow, tertiary│                                                                                 │
│ Prices · Staff · Settings               │                                                                                 │
│ ● Updated 2 min ago   (ConnectionStrip) │                                                                                 │
└─────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

- Rail collapses to 56 px icons below 1100 px; never a dark rail, never a hamburger on a desktop viewport, **two navigation levels maximum**:
  level 1 is the rail, level 2 is the page's tab row (≤ 4) — a detail opened from a register row is a side panel over that page, not a level.
- **Owner rail:** Today · Orders · Billing · Money · Stock · Shops · Reports · SETUP: Prices · Staff · Settings. **Manager rail:** Today ·
  Orders · Inbound · Fulfilment · Billing · Money · Registers · Shops · Stock · SETUP: Prices · Notifications. §9.0 places every `docs/23`
  screen under one of these. Live map and Imports (`docs/22` §2 owner functions) sit under Today and Settings; Load-out, where the manager
  gives the load-out PIN (`docs/22` §8, 2026-09-05), sits under Fulfilment.
- **The accountant** sees the manager rail; writes are enabled only on **Money** (office receipts, allocations, deposits, cheque bounces,
  write-offs — `docs/22` §8 "money desk + reads") and **Registers** (exports, Tally); Orders, Inbound, Billing, Shops, Stock and Prices are
  read-only with the reason shown ("Accountant: read only — ask the manager"); the load-out PIN, pick/pack, wave cancel, invoice cancel and
  staff screens are hidden, not greyed (403 by the matrix, `docs/23` §2.3).
- The distributor's logo and display name sit top-left on every screen (§11). Distribution OS's own mark appears nowhere here.

**Keyboard map — the Tally contract** `[UX-01 O3, O4]`, `[UX-02 R31]`: `/` global go-to · `⌘K` command palette · `Tab`/`Shift+Tab` fields
· `Enter` commit · `Esc` close one level · `↑ ↓` move, `Enter` open · `j`/`k` queues · `1`/`2`/`3` Approve / Reject / Ask · `⌘P` print · `?`
overlay. Every shortcut is printed on its button. **Numeric entry never re-sorts, re-filters or moves focus under the cursor** `[UX-01 O5]`.

### 8.2 Phone shell (sales, warehouse, delivery, retailer; and the desk apps' phone surfaces)

```
┌──────────────────────────────┐ insets.top — edge-to-edge is mandatory on Android 16 / targetSdk 36
│ Station Road · stop 7 of 18  │ header, bg.surface, hairline under: context line (field.label, secondary)
│ Shree Ganesh Kirana          │ title field.title; root screens show [logo 32] + display name instead
│ [Owes ₹18,400] [Limit ₹26,800]│ StatusChips with figures: field.moneyM, 28 dp — information only, no action up here
│ Updated 2 min ago            │ ConnectionStrip 28 dp (a 69 dp row while something is waiting, §6.11)
├──────────────────────────────┤
│ USUAL ORDER      field.eyebrow│ content on bg.ground; opens on the most likely next action
│ ┌ Group ──────────────────┐  │
│ │ row · row · row         │  │ scrolls; the top third is read, not touched
│ │ scheme footer (tint)    │  │
│ └─────────────────────────┘  │
├──────────────────────────────┤
│ 3 items · 4 cases    ₹1,564  │ bottom bar: bg.surface, hairline above, summary + field.moneyL total
│ [        Place order       ] │ primary at the app's floor: 69 dp field · 76 dp warehouse and delivery stop actions (§5.2)
└──────────────────────────────┘ + insets.bottom, always
```

- Every screen composes from `react-native-safe-area-context` insets from the first frame; a hard-coded `paddingTop` is a bug `[UX-03 §14a]`.
- **Tab bar** (`bg.surface`, hairline above, **69 dp + inset (76 dp warehouse)**, every tab the full bar height, `field.label` labels,
  active `accent.fg` with a filled icon, no pill): sales (**Beat · Orders · Shops · Me**) and warehouse (**Inbound · Pick · Pack · Load**; Me
  is the header avatar) have one — the tab lists and order are `docs/23` §3–§4 — **shown on root screens only**; a pushed screen replaces it
  with the action bar. Delivery and retailer have no tab bar: single stacks opening on the next stop / the last bill.
- **Owner and manager on a phone** (`phone` size, 63 dp): no tab bar. The owner's stack is rooted on Today (O1: the strip 2×2, the ageing
  ladder, approval cards); Approvals (O3), Live map (O4) and Growth (O2, the charts one tap away) push from Today's rows, and the rail's other
  destinations are a "More" list screen. The manager's phone stack is rooted on Today (M1) and pushes only confirm-and-photograph screens —
  capture (M3), gate count (M19), pick/pack (M20), load-out PIN (M7) `[UX-01 M2]`.
- One-handed: every primary flow completes with one right thumb `[UX-01 U9]`; nothing destructive under the resting thumb `[UX-01 U10]`.
- Two screens are designed to be turned around and shown across a counter — order confirmation and disputed quantity: single column, every
  figure ≥ 20 sp `[UX-01 S8, D5]`.
- **Performance is a layout constraint** `[UX-01 U11–U13]`, `[UX-03 §13]`: cold launch ≤ 1.5 s · first render ≤ 2.0 s · interactive ≤ 3.0 s
  · tap acknowledged ≤ 100 ms · scroll ≥ 55 fps · web route ≤ 600 KB gz field / 900 KB desk · download ≤ 30 MB · a working day ≤ 10 MB;
  photos compressed client-side to ≤ 1600 px / ~200 KB and queued as a normal state.

## 9. The screen map, and one worked screen per app

### 9.0 Where every `docs/23` screen lives

`docs/23-app-screens-and-api-gaps.md` is the binding inventory; this table gives each screen id its destination (rail › tab, or tab › push, or
stack push) and its §6 components, so the two documents describe one product. Detail views opened from a register row are side panels (desk)
or pushes (phone) and do not add a navigation level. `docs/23` was written against the 2026-09-04 draft of this file: its `§6.18` is now
§6.14, `§8.3` (budgets) is §8.2, `§11 "sign-in landing"` is §11 (the memberships picker), `§12 q5` is §14 q3, and its `<AgeingBuckets>` is
`<BarLadder>`; its rail line ("Today, Orders, Billing, Money, Stock, Reports, Settings") quoted the draft and is superseded by §8.1. The
`docs/23` author should re-point those five references; nothing in its screen list changes.

| App · shell                  | Destination → screens (`docs/23` ids) · components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner · desk rail (§8.1)     | **Today** › O1 Today (KpiStrip, TrendChart, CompareBars, StackedMix, BarLadder, approval rows) · O3 Approvals (Register + side panel, `1/2/3`) · O4 Live map (`Map.native`/web) — **Orders** › O5 Orders (Register + panel) · O18 Trips & settlements (Register, BarLadder) — **Billing** › O13 Bills, GST (Register, `⌘P`) · O14 Credit notes — **Money** › O10 Outstanding & ageing (Register, BarLadder, TrendChart) · O11 Receipts & banking · O12 Books · O19 Claims — **Stock** › O15 Stock (Register, StackedMix) · O16 Inbound (supplier invoices, GRNs, POs) · O26 Documents inbox · O9 Catalog & suppliers — **Shops** › O6 Retailers (Register with Sparkline rows + panel: statement, credit, overrides) — **Reports** › O2 Growth & performance (the chart set) · O17 Profit (owner-only route `[UX-01 O10]`) · O20 Incentives · O22 Exports & Tally — **SETUP** › Prices: O8 · Staff: O7 Beats & staff · Settings: O24 Settings (Branding, numbering, flags, policy) · O21 Imports wizard · O23 Notifications & templates · O25 Audit & security |
| Owner · phone stack (§8.2)   | Today (O1) → Approvals (O3, cards decidable in place) · Live map (O4) · Growth (O2) · More (the rail as a list)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Manager + accountant · rail  | **Today** › M1 — **Orders** › M2 Order queue (§9.2) — **Inbound** › M3 Documents (capture on phone, review on desk) · M4 Supplier invoices, GRN, discrepancies, POs · M11 Brand-DMS bills · M19 Gate count (phone) — **Fulfilment** › M5 Waves · M7 Load-out & challans (the PIN) · M20 Pick/pack (phone) — **Billing** › M6 Billing desk (keyboard loop `[UX-01 M1]`) · M8 Credit notes — **Money** › M9 Receipts & allocations · M10 Day-end (banking, cheques, trip settlement) · M17 Claims — **Registers** › M12 Registers (accountant home, days-to-11th) · M13 Tally export · M21 Team performance — **Shops** › M14 Retailers & credit — **Stock** › M16 — **SETUP** › Prices: M15 · Notifications: M18. Accountant scope per §8.1.                                                                                                                                                                                                                                                                                                                    |
| Sales · tabs (§8.2)          | **Beat** › S1 Aaj ka beat (ListRows with figure chips) → S2 Shop card (header chips, BarLadder, Group) → S3 Order entry (OrderLineRow, QtyStepper, Search, NumberPad; §9.3) → S4 Bargain (Sheet) → S5 Submit & status — **Orders** › S6 My orders · S5 Needs-attention tray — **Shops** › S2 by Search · S7 New shop (TextInput) · S10 Lapsed · S11 Catalog & stock · S12 Pending bills — **Me** › S8 Visits · S9 Performance (Sparkline, target bar) · S13 Inbox · S14 Me                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Warehouse · tabs (§8.2)      | **Inbound** › W1 Home queues → W2 Capture (Scanner, torch, "Type code") · W3 Gate count (NumberPad) · W8 Stock · W11 Reservations — **Pick** › W4 Queue → wave → W5 Picking sheet (§9.4) — **Pack** › W6 Pack per order → invoice issued (Dialog) — **Load** › W7 Load sheet (waits for the manager's PIN: read-only "Waiting for Sunil") → W10 Trips · W9 Van check-in (NumberPad) — header › W12 Me / inbox                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Delivery · stack (§8.2)      | D1 Today's trip → D2 Start trip (consent, odometer, opening cash NumberPad) → D3 Stop (§9.5) → D4 At the door (three `floor` buttons, PhotoCapture) → D5 Collect (NumberPad, receipt) → D9 Share; from D1/D3: D6 Van sale (flag `van_sales`) · D7 Expenses; from D1: D8 Day summary & check-in; from the strip: D10 Needs attention; from the header: D11 Trip history · D12 Me                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Retailer · stack (§8.2, web) | R1 Sign-in / link → R2 Distributor cards (one per membership, logo + name) → R3 Outstanding (§9.6: ListRow `moneyL`, BarLadder) → R4 Bill detail (seller block, POD) → R5 Pay (UPI QR) · R6 Statement · R13 Receipts; R7 Reorder (OrderLineRow) → R8 Order status; R9 Deals · R10 Request discount (Sheet) · R11 Profile · R12 Inbox                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 9.1 Owner · Dashboard (desk) — with the growth and performance graphs the founder asked for

```
Today                                                       Thu 3 Sep 2026   [Export ▾] [Print ⌘P]
──────────────────────────────────────────────────────────────────────────────────────────────────
SALES              │ COLLECTED          │ OUTSTANDING            │ FILL RATE           ← KpiStrip
₹1,84,200          │ ₹1,41,500          │ ₹8,62,400              │ 96.2%
▲ 12% vs last Thu  │ 2 trips active     │ ₹94,100 overdue        │ 4 short lines
──────────────────────────────────────────────────────────────────────────────────────────────────
Growth                                   [30 d] [90 d] [FY]   Performance
Sales · this 30 days vs previous 30                           Collections vs sales · 14 days
┌ TrendChart 160 px: accent.line 2 px, paper.600 dashed prev┐  ┌ TrendChart 116 px: sales accent.line, collections ochre dashed ┐
│                                                  ●      │   │ ── Sales  ─ ─ Collections          21 Aug ……… 3 Sep            │
└ 4 Aug ······················· 3 Sep · as of 6:10 pm ────┘   └────────────────────────────────────────────────────────────────┘
Month by month · FY 2026-27 vs 2025-26                        Money owed, by age                       ₹
▐▌ ▐▌ ▐▌ ▐▌ ▐▌ ▐▌  CompareBars, Apr → Mar                      0–7    ▓▓▓▓▓▓▓▓▓▓▓░░░░   5,12,300   ← BarLadder, six rungs
Brand mix · this month                                         8–15   ▓▓▓▓▓░░░░░░░░░░   2,56,000
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ■ Too Yumm 52% · ■ Campa 31% · ■ MOM 12% · ■ Other 5%   16–30  ▓▓░░░░░░░░░░░░░     94,100 … 90+ 0
──────────────────────────────────────────────────────────────────────────────────────────────────
Needs you (2)
Rate below floor · Sharma Kirana · ₹1.50/pc under floor                                    Open      ← rows on faint rules,
Over credit limit · R-0008 · ₹3,200 over                                                   Open        ghost link accent.fg
```

Every panel names its procedure; the screen formats nothing and derives nothing (`docs/22` §8: the owner graphs need `reporting.series`).

| Panel                                                    | Procedure · metric · grain · range · compare                                                                                        | Status (`docs/23`)                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| SALES · COLLECTED · OUTSTANDING (values, overdue, trips) | `reporting.dashboard.owner` → `todayInvoicedPaise`, `todayCollectedPaise`, `totalOutstandingPaise`, `overduePaise`, `activeTrips`   | planned (`owner_summary`)           |
| "▲ 12% vs last Thu"                                      | `reporting.series.get { metric: invoiced, grain: day, 7 d, compare: previousPeriod }` → today's `value` vs its `previous`           | MISSING §8.9                        |
| FILL RATE · "4 short lines"                              | `reporting.registers.fillRate` totals, today                                                                                        | planned                             |
| Growth · [30 d] [90 d]                                   | `series.get { invoiced, day, 30 or 90 d, compare: previousPeriod }` — 30/90 points                                                  | MISSING §8.9 (compare)              |
| Growth · [FY]                                            | the same TrendChart at **month grain**: `series.get { invoiced, month, Apr → now, compare: previousYear }` — ≤ 12 points, never 365 | MISSING §8.9 (month, YoY)           |
| Collections vs sales · 14 d                              | `series.get { invoiced, day, 14 d }` + `series.get { collected, day, 14 d }`                                                        | day rows planned; procedure MISSING |
| Month by month, FY vs last FY                            | `series.get { invoiced, month, 12 m, compare: previousYear }` → ≤ 12 groups                                                         | MISSING §8.9                        |
| Brand mix · this month                                   | `series.get { invoiced, month, 1 m, groupBy: brand }` ≤ 5 slices (`by_brand` jsonb)                                                 | planned rollup; procedure MISSING   |
| Money owed, by age                                       | `receivables.outstanding.list` → `totals.buckets` (six paise fields)                                                                | MISSING field §8.1                  |
| Needs you                                                | `orders.approvals.list status=pending` + `pricing.bargains.list status=requested`                                                   | ✓                                   |

"Shops that ordered 31 of 36" and "Avg days to pay 14" are **not drawn**: `owner_summary` carries neither (`avgDaysToPay` exists only per
retailer in `retailer_behaviour`, and daily `activeRetailers` cannot be summed to a month). They return when `owner_summary` gains
tenant-level `activeRetailersMtd` and `avgDaysToPay` — a field gap to add to `docs/23` §8.9. Every chart prints its range and "as of".
Phone surface: the strip stacks 2×2 at `field.hero`, then the ageing ladder, then "Needs you" as approval cards decidable in place (amount,
who, why, Approve / Reject / Ask) `[UX-01 O1, O2]`; the charts are one tap away (Today › Growth, §8.2). The profit view is an owner-only
route `[UX-01 O10]`.

### 9.2 Manager · Order queue (desk)

```
Orders   Submitted 12 · Confirmed 24 · Picking 6 · Packed 11                 [Export ▾] [Print ⌘P]
[Beat: Station Road ×] [Rep: all] [Today]  3 filters · clear
──────────────────────────────────────────────────────────────────────────────────────────────────
□  Order      Shop                    Beat           Lines  Amount ₹     Credit              State           ← desk.label heads
□  SO-1042    Shree Ganesh Kirana     Station Road   6      18,420.00    Owes 18,400 · 16–30 d  Submitted
■  SO-1043    Om Sai Provision        Station Road   9      42,800.00    Over limit ₹3,200      Needs approval  ← selected: accent.tint
□  SO-1044    Mahalaxmi General       Station Road   4      9,120.00     Clear                  Submitted
   …32 px rows, frozen Order column, no zebra, money right-aligned…
──────────────────────────────────────────────────────────────────────────────────────────────────
12 selected · ₹2,14,600.00                                   [Ask owner  3]  [Confirm 12  Enter]
```

Side panel (360 px) on `Enter`: the order's lines, applied schemes, and **the credit statement in one line at the point of confirming**
("Owes ₹18,400 · oldest 22 days · limit ₹26,800 — this order takes it ₹3,200 over") `[UX-01 M4]`. `j`/`k` move, `1` Confirm, `2` Reject with a
reason code, `3` Ask owner. **Confirm is server-authoritative, never optimistic and has no undo**: it is the stock check that reserves
(`docs/22` §4), and the order machine leaves `confirmed` only through `start_picking` or `cancel`. The button shows determinate progress
("Confirming 4 of 12"), the rows turn `Confirmed` as the server answers, and a mistaken confirm is a `Cancel` with a reason — the §6.12
dialog, since `cancelled` is terminal. What is undoable here is the selection. Issuing the invoice happens at pack in warehouse. The manager's
phone surface is confirm-and-photograph only `[UX-01 M2]`.

### 9.3 Sales · Shop screen (phone) — A's phone sketch, at field size

Header as §8.2 (context line, shop name, "Owes ₹18,400" `brick` chip and "Limit ₹26,800" `neutral` chip, both `field.moneyM` 28 dp) —
outstanding, ageing and last order are above the fold with zero taps `[UX-01 S10]`. Content: eyebrow "USUAL ORDER"; a `<Group>` of
`<OrderLineRow>`s (§6.6): collapsed rows show name, `2 cs = 48 pc`, the line total and the scheme chip "−₹68 · 1 free per 10", all figures
in `field.moneyM`; the row being edited shows `₹34.00/pc · 24 pc case`, the 69 dp `<QtyStepper>`, and `2 cs = 48 pc · 40 cs available`. At
360×640 that is three collapsed rows, or one editing row and one collapsed, above the bottom bar; at 360×800, five or 1 + 3 (§6.6). The
group footer carries only "Schemes on this order −₹68". Then `[Add item]` secondary (69 dp) and a "Suggested" group. Bottom bar: "3 items ·
4 cases" + `₹1,564` at `field.moneyL`, `[Place order]` **69 dp**. Repeat order in **3 taps from cold open**, modified in ≤ 15 taps (13 with
five edited lines, §6.6), measured in Maestro `[UX-01 S1]`; the draft persists within 500 ms of every keystroke and restores to the cursor
`[UX-01 S4]`; geo-tag is an `ochre` chip with a distance, never a gate `[UX-01 S5]`; the bundle contains no cost string `[UX-01 S9]`.

### 9.4 Warehouse · Picklist (phone, 76 dp)

```
Picklist · Trip KL-2                    6 of 14 picked   ← header + progress; strip beneath
Campa Cola 750 ml                                        field.bodyStrong
Batch B2207 · Exp 12/26 · MRP ₹20.00     Bin A-12        lot line; MRP at field.moneyM (≥ 20 sp) [UX-01 W8]
3 cs + 4 pc = 76 pc                                      field.moneyM
[Older lot first · B2201 ]                               ochre chip, colour + icon + word
[      Picked      ]   [ Short ]                         76 dp primary-per-row · secondary, 25 dp gap [UX-01 W1]
──────────────────────────────── faint ──────────────────
… next line …
[ Confirm 14 lines ]  "8 lines not yet picked"           76 dp; disabled until every row is picked or short: bg.surface, border.strong
                                                         outline, label in text.disabled (8.35:1), the reason beneath — never greyed
```

Every tap persists on the instant — there is no Save step `[UX-01 W4]`; short lines become their own pack rows, never order edits; scan
screens carry an equal-size "Type code" button and a torch toggle that survives the session `[UX-01 W3, W10]`; the gate count is a
full-screen `<NumberPad>` with nothing else on screen `[UX-01 W2]`.

### 9.5 Delivery · Stop (phone, no swipes)

```
Stop 4 of 11 · Station Road                              context line; strip beneath
Shree Ganesh Kirana                                      field.title
12, Station Road, Kalyan W          [ Call ]             69 dp call button (`field`), one tap until the stop closes [UX-01 D10]
┌ Group: bills on this stop ─────────────────────────┐
│ GL/1688 · 3 Sep · 6 lines                ₹18,420.00 │   field.moneyM
│ GL/1642 · 28 Jul · Overdue · 30 days      ₹4,200.00 │   brick solid chip, field.moneyM (30 days past its 4 Aug due date; §3.3)
└─────────────────────────────────────────────────────┘
To collect                                 ₹22,620      field.hero (expected; never pre-filled into the pad)
[            Delivered            ]                      76 dp (`floor`: the three stop actions, §5.2)
[             Partial             ]                      76 dp secondary
                                                         ≥ 50 dp gap
[             Failed              ]                      76 dp destructive outline — the reason picker follows
```

Delivered → photo (queued, never blocking) → Collect (Cash / UPI with UTR / Cheque) → receipt number immediately. ≤ 3 taps clean, ≤ 5 with
collection `[UX-01 D3]`. Nothing requires interaction while the vehicle moves `[UX-01 D1]`; everything survives a dead battery `[UX-01 D7]`;
the GPS foreground notification names the distributor ("Trip in progress — location shared with Tarsun Enterprises") `[UX-01 D8]`.

### 9.6 Retailer · Bills (phone, online only, one card per distributor)

```
Shree Ganesh Kirana                                      the shop's own name; no sign-up, no permission prompt [UX-01 R1, R8]
[ (T) Tarsun Enterprises · ₹18,400 ]  [ (K) Kalyan Agencies · ₹0 ]   one card per linked distributor, never merged [UX-01 R11]
Updated just now
You owe Tarsun Enterprises                    ₹18,400    field.hero
┌ Group: bills, oldest first ────────────────────────┐
│ GL/1642 · 28 Jul        [31–60 days]     ₹4,200.00 │   ListRow trailingSize="moneyL" [UX-01 R7]; ageing chip = colour + icon + word,
│ GL/1688 · 3 Sep         [0–7 days]      ₹14,200.00 │   37 days since the invoice date (§3.3) — the same bill the stop above calls 30 days overdue
└────────────────────────────────────────────────────┘
[ Pay ₹18,400 ]   69 dp → the distributor's UPI QR (from upi_vpa) one tap away on every bill
[ Order again ]   69 dp secondary — 2 taps from the WhatsApp link [UX-01 R3]
```

Nothing here needs an English sentence: bill number, date, ₹, a chip, a QR `[UX-01 R10]`. Every outcome also arrives on WhatsApp `[UX-01 R9]`.
Distribution OS is never named on this screen.

## 10. Product brand — DECIDED: Distribution OS (founder, 2026-09-05)

**Decision.** The product is named **Distribution OS** (option C below). Each app is listed and labelled as "Distribution OS - Owner",
"Distribution OS - Manager", "Distribution OS - Sales", "Distribution OS - Warehouse", "Distribution OS - Delivery", "Distribution OS - Retailer".
The wordmark and icon rules of option C apply; the role name follows the mark on the sign-in screen and in the store listing only. Inside
the apps the distributor's own name and logo show (§11). Options A and B are kept below as history.

### 10.0 The three options that were considered

The founder has no brand and asked for one (`docs/17` §D6). Constraints: the product mark appears **only on the sign-in screen and in the
store listing** (`docs/22` §9 item 10); every colour comes from the A palette; the mark must work at 16 dp, in one colour on the store-listing
screenshot and the sign-in screen, and beside any distributor's logo without competing. It is never printed: no receipt, invoice or challan
carries it (§11).

**Option A — Vitran** (वितरण, "distribution").

- _Why:_ owns the category word in the market's own language; one word a distributor's brother-in-law repeats after hearing it once, and
  this product spreads by word of mouth between distributors.
- _Wordmark:_ IBM Plex Sans SemiBold 600, lowercase `vitran`, ink `#1B1E1A`, tracking −0.01 em, no tagline. _Mark_, left of the word at
  cap height: a `petrol.700` square with 22% corner radius containing two white horizontal rules of unequal length — a stock line over a
  shorter shipped line, a ledger entry; not a truck, box or globe. Works at 16 dp, in one colour, and as a favicon.
- _Primary colour:_ `petrol.700` `#0B5A63`. _App icon:_ the square mark; the six apps share the silhouette and differ by one white role
  glyph inside it (chart · list · shop · box · van · receipt), so a rider finds his in one glance.

**Option B — Bahi** (बही, the account book).

- _Why:_ names what direction A _feels_ like and what the owner already calls his ledger; short, warm, ownable.
- _Wordmark:_ IBM Plex Sans Bold 700, Title case `Bahi`, ink. _Mark:_ two stacked pages drawn as `petrol.700` 1.5 px rectangles offset
  2 px, no fill — hairlines, like the product.
- _Primary colour:_ ink `#1B1E1A` for the word, `petrol.700` for the mark. _App icon:_ ink square, white double-page glyph, the role glyph in
  `petrol.onDark` at the lower-right corner.

**Option C — Distribution OS** (keep the working name).

- _Why:_ accurate, already on every document and in the repo; reads well to a bank, a brand manager or an investor. Harder to say in
  Marathi, and "OS" means nothing to a shopkeeper.
- _Wordmark:_ IBM Plex Sans Regular 400 `Distribution` followed by SemiBold 600 `OS` in `petrol.700`, one line, no mark.
- _Primary colour:_ `petrol.700`. _App icon:_ `petrol.700` square, white `OS` in Plex Bold, the role glyph beneath the letters.

**Recommendation: A, Vitran.** It is the only name that says what the product is in the language of the people who buy it, and the ledger
mark carries the A character without the name having to. B is the strongest fit for the look but "bahi-khata" apps crowd the store listing;
C stays as the legal/company name either way. A trademark search on "Vitran" (there was a Canadian carrier of that name) is an open item.

## 11. White-label — where the distributor's own name and logo appear

**Rule (`docs/22` §9 item 10):** inside every app and on every document the distributor sees and shows _their_ business, never ours. The
distributor supplies **a name and a logo, never a colour** — a tenant-controlled accent would void every ratio in §3.

**Keys** (`tenant_settings`, defaults in `backend/libs/database/src/tenant-bootstrap.ts`). They reach the wire today **only inside
documents**, as the `seller` block (`SellerBrandingSchema` in `@dos/contracts` billing) on `InvoiceDetail`, `CreditNoteDetail` and
`DeliveryChallan`; app chrome, the memberships picker, the GPS notice and the retailer cards depend on `tenancy.branding.get` and the
`displayName` + `logoUrl` fields on `MembershipSummary`, both MISSING in `docs/23` §8.12–§8.13. Until they land, chrome shows the legal
name from `tenancy.me` and an initials box.

| key                        | type   | absent means                                             | read by                                                             |
| -------------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `branding.display_name`    | string | falls back to `tenants.legal_name`                       | every surface below                                                 |
| `branding.logo_object_key` | string | **no logo**: initials avatar in apps, name-only on paper | app chrome, PDF headers, memberships picker, retailer cards         |
| `branding.invoice_footer`  | string | footer line omitted                                      | invoice, credit/debit note, statement PDFs                          |
| `branding.address`         | object | address block omitted                                    | tax invoice, challan, statement                                     |
| `seller_fssai`             | string | FSSAI line omitted from the invoice header               | tax invoice, credit/debit note (food licence; same Branding screen) |
| `upi_vpa`                  | string | no QR printed, `upiQr` answers `null`                    | invoice QR, retailer Pay button, receipt                            |

(`backend/libs/contracts/src/billing.ts` comments still name `logo_asset_id`; the key is `branding.logo_object_key`. Fix the comment.)

| surface                              | owner (desk + phone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | manager | sales                                                             | warehouse      | delivery                                                    | retailer                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- | -------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App bar / rail                       | Logo 28 px + display name, rail head, every screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | same    | Root-tab headers: logo 32 dp + name; pushed screens: context only | same as sales  | Trip screen header: logo + name; stop screens: context only | The **shop's** name in the header; each distributor card and each bills screen carries that distributor's logo + name                                                                                              |
| Sign-in                              | **Only the product brand before authentication** — sign-in is one `POST /auth/login {username, password}` (`docs/22` §7) and a pre-auth username → distributor lookup would tell anyone which distributor a username belongs to (`docs/17` item 27). After the token lands: one membership → straight into the app, whose header carries the logo; several → the memberships picker, one card per membership with that distributor's logo + name (needs `displayName` + `logoUrl` on `MembershipSummary`, `docs/23` §8.12) | same    | same                                                              | same           | same                                                        | Same picker (the retailer cards of §9.6). "Lands already identified" from the WhatsApp link depends on `auth.loginWithLink` (`docs/23` §8.12, MISSING); until then the shop signs in once with username + password |
| Documents (PDF, server-rendered)     | Tax invoice, credit/debit note, statement, delivery challan, load sheet, picklist print: header = logo (18 mm box) + display name + legal name if different + address + GSTIN + FSSAI; footer = `branding.invoice_footer`; UPI QR from `upi_vpa`. No product mark anywhere on paper.                                                                                                                                                                                                                                       |         |                                                                   |                |                                                             |                                                                                                                                                                                                                    |
| Receipts (58/80 mm thermal, and PDF) | display name + receipt number + amount + bill allocation; no logo on thermal (name set at 1.5×)                                                                                                                                                                                                                                                                                                                                                                                                                            |         |                                                                   | Not applicable | Issued at the door                                          | Shown in-app and on WhatsApp                                                                                                                                                                                       |
| WhatsApp messages                    | Sender identity is the distributor's WABA; the body opens with the display name: "Tarsun Enterprises · Invoice GL/1688 · ₹18,420 · due 12 Sep"                                                                                                                                                                                                                                                                                                                                                                             |         |                                                                   |                | POD and receipt messages                                    | invoice, POD, receipt, statement                                                                                                                                                                                   |
| Push / OS notifications              | Title = display name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | same    | same                                                              | same           | GPS foreground notice names the distributor                 | Title = the distributor the message concerns                                                                                                                                                                       |

**Logo constraints** (`<TenantLogo size="rail|header|card|print">`): PNG or SVG, ≤ 512 KB, short side ≥ 256 px; aspect between 1:1 and
3:1, fitted (never cropped, never stretched) into a **28 px** (rail) / **32 dp** (phone header) / **40 dp** (retailer card) / **18 mm**
(print) box on `bg.surface`; never tinted, never placed on the accent; a `border.faint` hairline is drawn only if the logo has no natural edge.
**Fallback:** up to two initials from the display name in `field.bodyStrong` `text.primary` on `bg.sunken`, `radius.sm` (not round — it is a
mark, not a person). On paper with no logo the name is simply set larger; no initials box is printed. The owner uploads and previews all
four sizes and the invoice header in Settings → Branding, and the upload is the only place the logo is ever written.

**Worked example — Tarsun Enterprises.** Rail head: `[T]` initials box (no logo uploaded yet) · "Tarsun Enterprises" `desk.railTitle` ·
"Kalyan · FY 2026-27" `desk.meta`. Sales phone root header: `[T]` 32 dp · "Tarsun Enterprises" `field.title`. Invoice header, left: logo box 18 mm (or
nothing), **Tarsun Enterprises** 14 pt bold, legal name if it differs, "Shop 4, Station Road, Kalyan West 421301 · GSTIN 27AAXXX1234A1ZP ·
FSSAI 1151…"; right: "Tax invoice · GL/1688 · 3 Sep 2026 · Due 12 Sep"; totals block; UPI QR bottom-left with "Pay Tarsun Enterprises ₹18,420
· UPI tarsun@upi"; footer = `branding.invoice_footer` ("Goods once sold will not be taken back. Subject to Kalyan jurisdiction."). The words
"Distribution OS", "Vitran" or any product mark: absent.

## 12. Writing

English only for now, and the flow must survive a user who reads no English sentence `[UX-01 U15]`. Five rules: (1) the trade's own word,
not the software's; (2) labels ≤ 20 characters, buttons verb + object, a sentence never carries a flow; (3) never abbreviate money except on an
axis; (4) state the next action, not the problem; (5) no exclamation marks, "Oops", "Great job" or emoji anywhere.

| Never say                                                 | Say                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COGS · AR · Aging · SKU · ATP · MOV · FOC                 | **Purchase cost · Outstanding · Ageing · Item · Available · Minimum order · Free**                                                                      |
| PTR / PTD / landing · POD · PJP · PCR · DSO · FEFO · SLOB | **Retailer rate / Your rate / Landed cost · Delivery proof · Beat plan · Shops that ordered · Average days to pay · Oldest expiry first · Slow moving** |
| Sync, queue, idempotency · Tenant                         | **Waiting to send** · the distributor's own name                                                                                                        |
| Submit, OK, Done, Save (for a commit)                     | **Place order · Post GRN · Issue invoice · Confirm delivery · Record payment · Close trip**                                                             |
| Error 4xx, "Something went wrong"                         | the business reason and the next action                                                                                                                 |

Keep the trade's words unexplained: beat, scheme, case, pieces, MRP, GRN, LR, credit note, invoice, godown, claim, batch, expiry. Dates:
IST, business date, "Today" / "Yesterday" / "4 Sep", times "9:40 am", never a relative date beyond 7 days on a bill. Address the user
("Your beat today"); money in the third person; the app is never the subject ("Not sent yet — waiting for signal").

## 13. What we will not do (walked per screen before "stable")

**Chrome:** a dark rail (★ delete `frontend/owner-app/src/styles.css`); Bootstrap blue (★ delete `frontend/libs/ui/src/tokens.ts`); border +
shadow + radius on one element; cards in cards; breadcrumbs; centred titles; three-level nav; a hamburger on desktop; 5+ tabs or truncated
labels; a big-logo splash; a dashboard that opens blank until filtered. **Visual:** gradients, glass, neumorphism; emoji icons or mixed icon
sets (one set, 1.75 px stroke, 24 dp grid); uppercase anywhere but eyebrows; a FAB by default; paper textures or rupee motifs; illustrated
empty states; pill primary buttons; dark mode on a field app. **Numbers:** proportional numerals in a column; `₹` at the amount's weight in a
hero; mixed precision; a desktop table shrunk onto a phone; `type="number"`; status by colour alone; 3D or shadowed charts, rainbow palettes,
a chart without its range. **Interaction:** a Sync-now button; a blocking modal for sync/GPS/permission; `alert()`; a centred spinner for a
known shape; success toasts as the record; a dialog on a reversible action, or undo on an irreversible ledger write (§6.12 lists which is
which); 400–600 ms transitions; hover-only affordances; swipe-to-complete or slide-to-confirm anywhere (and nothing gestural at all in
delivery); a geo-fence that blocks work; a permission prompt on open; a registration form before a retailer; losing a half-typed order to a
phone call. The last two decide adoption.

## 14. Open questions for the founder

1. **Product name** — A Vitran (recommended), B Bahi, or C Distribution OS (§10). One letter unblocks the sign-in screen and store listing.
2. **Typeface** — IBM Plex Sans (this document) or Inter as seen in the A sketch. Plex is recommended for the reasons in §4.1; switching is a
   font swap plus `tnum` everywhere, nothing else.
3. **WhatsApp sender** — the distributor's own WABA (recommended, matches white-label) or one shared number. Decides the WABA setup.
4. **Dark mode** for owner/manager: tokens are defined; ship the toggle in v2 (recommended).
5. **Six app icons** — one shared mark with a role glyph (recommended) or six distinct marks.
6. **Haptics default** Full (recommended); it is a per-device setting either way.
7. **Buy the reference handset** (~₹9,000, 4 GB) and measure Tarsun's staff phones' brightness; time one rep on a real beat; confirm loaders
   work bare-handed `[UX-01 §9]`. Nothing in §8.2's budgets is real until measured.
8. **The 12 px desk eyebrow** (§4.3, §3.6): the only text token under UX-01 U8's 14 px floor, kept for A's character on the desk only. Accept,
   or raise it to 14 px — one line in `tokens.ts` either way.

## 15. Per-app character, in one line each

Owner — the instrument panel: calm, dense, numerate, the only user who browses. Manager + accountant — the keyboard loop: 60–120 invoices a
day, hand never leaving the keys, the count of what remains always visible `[UX-01 M1]`; GST screens count down to the 11th `[UX-01 O7]`.
Sales — ninety seconds in a doorway: big, fast, forgiving, one-thumbed. Warehouse — put it down, pick it up: loud, literal, indestructible.
Delivery — three big buttons and a number, and the other hand has cash in it. Retailer — the detail view for a WhatsApp message: two screens,
no words, his own shop's name at the top and the distributor's name, never ours.

## 16. How this is enforced

| check                                                                                                                                                                      | where                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| No hex literal outside `shared-ui/tokens.ts`; no `expo-haptics`, chart-library or RN-primitive import in a screen; no animation without `ReduceMotion`; no `type="number"` | ESLint                                  |
| `.web.tsx` count in owner + manager ≤ 18                                                                                                                                   | CI script                               |
| No cost string in the sales, warehouse, delivery or retailer bundle                                                                                                        | role-leak dump, extended to bundles     |
| Cold start, TTI, bundle size, web gzip, day data budget                                                                                                                    | CI on the reference device + Expo Atlas |
| 3-tap reorder · ≤ 3-tap delivery · 2-tap retailer reorder                                                                                                                  | Maestro flows, fail on regression       |
| Screenshots on the 4 GB Android **and** an iPhone, light (dark for desk, v2), at 100% and 200% font                                                                        | before a module is called stable        |
| §13 walked screen by screen; §11 surfaces show the distributor's name, never the product's                                                                                 | design review, per module               |

## Sources

Repo: `docs/22-source-of-truth.md` · `docs/design/layout-options.html` (direction A) · `UX-01-field-reality.md` · `UX-02-current-standards.md`
· `UX-03-technical-constraints.md` · `docs/17-corrections-from-review.md` §D6 · `backend/libs/database/src/tenant-bootstrap.ts` ·
`backend/libs/contracts/src/billing.ts` (`SellerBrandingSchema`) · `docs/domain/operational-pain-points.md` · `docs/domain/glossary.md`.
Fonts inspected with fontTools 4.60.2 on 2026-09-04 (Plex digit advance 600/1000 at every weight; Inter proportional by default). Contrast
ratios computed to WCAG 2.x relative luminance on 2026-09-05.
External: Expo fonts https://docs.expo.dev/develop/user-interface/fonts/ · WCAG 2.2 1.4.6, 1.4.11, 2.5.8
https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html · ISO/TS 9241-411 · M3 motion tokens
https://m3.material.io/styles/motion/easing-and-duration/tokens-specs · Android haptics https://developer.android.com/develop/ui/views/haptics/haptics-principles
· Apple HIG — Playing haptics · Reanimated `ReduceMotion.System` · Expo edge-to-edge https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
· Hoober / Smashing 11–12 mm targets https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/ · Polaris tokens https://github.com/Shopify/polaris-tokens
