# Design System & Brand

## Document Information

| Property     | Value                 |
| ------------ | --------------------- |
| Document     | Design System & Brand |
| Product      | Distribution OS       |
| Version      | 2.0                   |
| Status       | Active                |
| Owner        | Product Management    |
| Last Updated | September 2026        |

---

# Purpose

This page states **how Distribution OS looks, reads and feels, and what it is called** — the layout direction, the product brand, the white-label rule, and the evidence-based rules that every screen in every app is built against.

It exists because the six role apps have not been built yet. The backend was built first by founder decision (2026-09-04). As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). **No app screen exists yet.** Everything below is therefore a _contract for screens about to be written_, not a description of screens you can open. It is written now so that the first screen and the two-hundredth screen look like the same product.

**Source of truth.** `docs/22-source-of-truth.md` in the repository is the master document; the full design specification is `docs/design/UX-00-design-system.md`, built on three evidence files (`UX-01` field reality, `UX-02` current standards, `UX-03` technical constraints) and the four layout mockups in `docs/design/layout-options.html`. This page summarises them for readers who will not open 900 lines of specification. Where this page and the repository disagree, **the repository wins**.

---

# The decisions that bind every screen

| Decided    | Decision                                                                                                                                                                  | Where it lives                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 2026-09-05 | **Layout direction A "Ledger"** chosen from four mockups; applies to all six role apps (the admin console adopts the desk density of the same system when it is designed) | UX-00 §1, `layout-options.html` |
| 2026-09-05 | **Product name is "Distribution OS"**; apps are "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer"                              | UX-00 §10                       |
| 2026-09-04 | **White-label**: inside every app and on every document the distributor sees their own name and logo, never ours                                                          | UX-00 §11, `tenant_settings`    |
| 2026-09-04 | **English only for now**; the flow must still work for a user who reads no English sentence                                                                               | UX-00 §12                       |
| 2026-09-04 | **Online-first now; offline for sales and delivery before the pilot**                                                                                                     | UX-00 §6.11, ADR 0007           |
| 2026-09-04 | **Haptics and "feel good"** are a requirement, not a polish item — with the limits in the Haptics section below                                                           | UX-00 §7                        |
| 2026-09-04 | Every app ships **web + Android + iOS** from one codebase (the seventh, platform-admin app is web only)                                                                   | UX-00 §2                        |
| 2026-09-05 | **Seventh app**: "Distribution OS - Admin", the platform console, web only, desk density                                                                                  | `docs/22` §2 and §8             |

---

# 1. Layout: direction A, "Ledger"

Four directions were drawn as working mockups — **A Ledger, B Instrument, C Panel, D Signal** — and the founder picked one letter on 2026-09-05, **ahead of** the original "after the backend is complete" sequencing (decided 2026-09-04), so that design work is unblocked. App screens still start only when the backend is complete — which is what `docs/18-build-log.md` records under LAYOUT CHOSEN.

**A in one sentence:** a well-kept accounts book that answers instantly. A warm off-white page, near-black ink, thin rules instead of boxes, and one deep teal for anything you can act on.

Why it won: it feels like the ledger it replaces, so staff trust it on sight; it shows the most numbers per screen of the four; and it ages slowly. **The cost was accepted openly:** it is deliberately plain and will never make anyone say "wow" in a demo.

Five properties a reviewer checks first:

1. The page ground is warm off-white, surfaces are white, and **no card, row, strip, table, chip or input carries a shadow**.
2. Groups are separated by hairlines, never by boxes inside boxes.
3. The only saturated colour that is not a status is the accent (petrol).
4. KPIs are columns of a register strip, not tiles.
5. Charts are 2 px lines on hairline gridlines, with no fills.

## One system, two densities

There are **two densities, not two design systems**. Every colour, type and spacing token is identical on both; what changes is grid density, navigation and primary input.

| Aspect         | Desk — owner, manager + accountant, platform admin | Field — sales, warehouse, delivery, retailer                    |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Primary device | PC at 1366×768; phone secondary                    | 4 GB / 720p / 4G Android at 5.5–6.6", and its iPhone equivalent |
| Primary input  | Keyboard — no action needs a pointer               | One right thumb — no action needs two hands                     |
| Density        | 32 px register rows, 14 px cells, 20 px gutters    | 72–96 dp rows, 16 sp body, 16 dp gutters                        |
| Theme          | Light default; dark tokens defined, shipped in v2  | **Light only**; never reads system appearance                   |
| Tables         | Real tables: sticky head, frozen first column      | Grouped list cards. **Never a table**                           |
| Primary action | Page-header right, plus Enter                      | Bottom third of the screen, above the safe-area inset           |

A desk app opened at phone width gets the phone shell. A field app's web build gets field tokens and field sizes on every target — density follows the app class and the viewport, never the platform.

**Navigation is two levels maximum on desk:** the left rail is level 1, a page's tab row (four tabs at most) is level 2. A detail opened from a register row is a side panel over that page, not a third level. On phone, sales and warehouse have a four-item tab bar on root screens only; delivery and retailer are single stacks that open on the next stop and the last bill.

---

# 2. Brand: Distribution OS

**Decided 2026-09-05.** Three candidates were prepared — _Vitran_ (वितरण, "distribution"), _Bahi_ (बही, the account book) and _Distribution OS_. The design recommendation was Vitran, on the argument that it names the category in the buyer's own language. **The founder chose Distribution OS**, the working name already on every document and in the repository: accurate, and it reads well to a bank, a brand manager or an investor.

| Element                | Rule                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark               | "Distribution" in the regular weight, "OS" in semibold and the petrol accent, one line, no separate mark, no tagline                        |
| App names              | "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer", "- Admin"                                     |
| Where it appears       | **Only** the sign-in screen, the app icon label and the store listing                                                                       |
| App icon               | A petrol square with "OS" in white; the six role apps share the silhouette and differ by one role glyph, so a rider finds his in one glance |
| Where it never appears | Inside any app after sign-in; on any invoice, credit note, challan, receipt, statement or WhatsApp message                                  |
| Legibility             | The mark must work at 16 dp, in one colour, and beside any distributor's logo without competing                                             |

The role name follows the mark on the sign-in screen and in the store listing only.

---

# 3. White-label: whose business is on the screen

**The rule (a non-negotiable, `docs/22` §9 item 10):** inside every app and on every document, the distributor sees and shows _their_ business, never ours.

**The distributor supplies a name and a logo — never a colour.** A tenant-controlled accent would void every contrast ratio in the system, so brand colour is not configurable. This is a deliberate limit, and it is the answer to "can we make it match our brand colours?".

| Surface                       | What the distributor's user sees                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                       | **Only the product brand**, before authentication — a pre-auth lookup would reveal which distributor a username belongs to                     |
| After sign-in, one membership | Straight into the app; the header carries the distributor's logo and display name                                                              |
| After sign-in, several        | A memberships picker: one card per distributor, each with that distributor's logo and name                                                     |
| App bar / desk rail           | Logo plus display name on every screen                                                                                                         |
| Printed documents             | Header = logo, display name, legal name if different, address, GSTIN, FSSAI; footer = the distributor's own footer line; UPI QR from their VPA |
| Thermal receipts              | Display name, receipt number, amount, bill allocation; no logo on thermal paper                                                                |
| WhatsApp and push             | Sender identity is the distributor's own WhatsApp Business account; the message opens with their display name                                  |
| Retailer app                  | The **shop's** name in the header; each distributor card carries that distributor's logo and name                                              |

Branding keys live in `tenant_settings` (display name, logo, invoice footer, address, FSSAI number, UPI VPA), and the owner uploads and previews all sizes in Settings → Branding. **Partial today:** these values already reach printed documents through the seller block in the billing contract; the app chrome, the memberships picker and the retailer cards still need a branding read endpoint and logo fields on the membership summary (`docs/23` §8.12–§8.13). Until those land, chrome falls back to the legal name and an initials box.

---

# 4. The field rules

These come from measured evidence (`UX-01`), not taste, and they override any visual preference. A screen that breaks one of them is not "stable".

| Rule                                                                                                                                                                                                              | Why                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **7:1 contrast for every piece of text in a field app** (WCAG AAA), not 4.5:1                                                                                                                                     | Direct sun is 80,000–200,000 lux; an entry-level 450–600 nit panel has no headroom for subtle greys                    |
| **11 mm (69 dp) minimum tap target** in sales, delivery and retailer; **12 mm (76 dp)** on every warehouse screen and for the delivery stop actions; 10 mm (63 dp) on owner/manager phone surfaces; 24 px on desk | ISO/TS 9241-411 and handheld field studies. Material's 48 dp is 7.6 mm and Apple's 44 pt ≈ 7 mm — both below our floor |
| Gaps: **3 mm between adjacent targets, 4 mm in the warehouse, 8 mm between a confirming and a destructive action**                                                                                                | Rage-taps and mis-taps while standing, walking, wet or in a moving vehicle                                             |
| **Taps only.** No swipe-to-complete, no slide-to-confirm, nothing gestural at all in delivery                                                                                                                     | Gloves, wet hands, one-handed use, and a rider who cannot afford a mis-swipe on a ledger write                         |
| **Light theme only in the field**; never reads system appearance. Dark mode is a desk feature, planned for v2                                                                                                     | Ambient contrast collapses outdoors; a dark screen in sun is unreadable                                                |
| **Device floor: 4 GB RAM, 4G, Android 11+ / iOS 16+, 450–600 nit screen.** Budgets: cold launch ≤ 1.5 s, first render ≤ 2.0 s, tap acknowledged ≤ 100 ms, scroll ≥ 55 fps, a working day ≤ 10 MB of data          | The salesman and the rider buying a ₹9,000–12,000 handset are the actual users; memory prices rose ~4× since 2025      |
| **Money and quantity figures at 20 sp or larger**; body text 16 sp; the one number a screen exists for at 24–44 sp; nothing below 14 sp                                                                           | Outdoor legibility, and the number is the reason the screen exists                                                     |
| **Every primary action sits in the bottom third**; nothing destructive under the resting thumb                                                                                                                    | ~49% of users are one-handed and 67% right-thumbed; bottom placement preserves one-handed reach                        |
| **Colour is never the only channel** — every state is colour plus icon plus word                                                                                                                                  | Colour vision, sunlight, cheap panels                                                                                  |
| **Quantity is never a free text field**, and is always dual-unit ("2 cs + 6 pc = 186 pc"), never toggled                                                                                                          | The trade counts in both units at once                                                                                 |

Two screens are designed to be turned around and shown across a counter — order confirmation and disputed quantity: single column, every figure at 20 sp or larger.

## Colour, type and space, in brief

- **Palette:** a warm paper neutral (ink is a warm near-black), one accent (**petrol**, a deep teal — dark enough for white text at AAA, unclaimed in Indian distribution software, calm beside any distributor's logo), and five status families: moss (positive), ochre (caution), clay, brick (critical) and neutral. Every text pair was computed against WCAG relative luminance, not estimated.
- **Status colour means one thing:** green paid, amber due, red overdue. Ageing runs as one ordered six-rung ladder matching the 0-7 / 8-15 / 16-30 / 31-60 / 61-90 / 90+ buckets in `docs/22` §6.
- **Working typeface: IBM Plex Sans** — the recommendation, still awaiting the founder's confirmation in §9. Chosen because its digits are tabular at every weight with no feature flag that can fail silently on a cheap Android, the rupee glyph is present, and its Devanagari sibling has the identical digit advance — so a later Marathi pass is a font swap, not a redesign.
- **Numbers:** integer paise in and out, Indian grouping (₹1,24,500.00), fixed two decimals down a column, the rupee sign stated once per column, tabular everywhere.
- **Space:** one 4 px scale. Radii are tight (4/6/8/12/20). **Exactly four things carry a shadow** — bottom sheet, dialog, menu, and the sticky bottom bar while content scrolls under it. Everything else is flat.

---

# 5. Motion and haptics

Motion is short and functional: 50–100 ms for press feedback, 150–200 ms for enter/exit, 250–300 ms for sheets and dialogs, and nothing routine over 300 ms. Only transform and opacity animate; every animation respects the operating system's reduce-motion setting; there is no splash animation.

**Haptics** (founder requirement, 2026-09-04) go through one shared façade — `select`, `toggle`, `gestureStart`, `success`, `warning`, `error`, `destructive` — so no screen calls the haptics library directly. Strength scales inversely with frequency. A user setting offers **Full / Important only / Off**, defaulting to Full, per device.

Two honest limits:

1. **On a ₹9,000 handset's actuator, "success" and "error" feel alike.** So a haptic always _confirms a visible state change and is never itself the signal_. The record of what happened is on screen: the outcome word, the invoice or receipt number, the screen advancing.
2. **Web has no haptics.** Every role app ships as web + Android + iOS from one codebase; the retailer app's **web build ships first**, so it is visual-only until its native build lands.

Order placed, payment collected, delivery confirmed, GRN posted, invoice issued, trip settled and approval granted get `success`. Partial delivery, bargain rejected and settlement variance get `warning`. Credit stop, scan rejected and delivery failed get `error`. Navigation, scrolling, keypad digits, screen loads, toasts and pull-to-refresh get **nothing** — sound is never a channel at all.

**Optimistic UI** is used for what the device can validate by itself (order lines, check-in, visits, drafts, delivery outcomes, receipts with a client receipt number). It is **never** used for confirming an order, issuing an invoice, posting a GRN, closing a trip, approving a credit override, cancelling an invoice, reversing a receipt, a cheque bounce or a write-off: those show determinate progress, carry one idempotency key per user intent, and are never undoable — corrections are credit notes and reversals, which is how the ledger works.

---

# 6. Language and connectivity

**English only for now** (decided 2026-09-04), with a hard constraint attached: every flow must survive a user who reads no English sentence. Meaning is carried by numbers, icons, the trade's own vocabulary and screen position, not by prose. Marathi and Hindi are a font swap and a string catalogue away by design, not a redesign.

Five writing rules: use the trade's word, not the software's; labels at 20 characters or fewer and buttons as verb + object; never abbreviate money except on a chart axis; state the next action, not the problem; and no exclamation marks, "Oops", "Great job" or emoji anywhere.

| Never say                        | Say                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| COGS, AR, Aging, SKU, ATP, MOV   | Purchase cost, Outstanding, Ageing, Item, Available, Minimum order     |
| POD, PJP, DSO, FEFO              | Delivery proof, Beat plan, Average days to pay, Oldest expiry first    |
| Sync, queue, idempotency; Tenant | "Waiting to send"; the distributor's own name                          |
| Submit, OK, Done, Save           | Place order, Post GRN, Issue invoice, Confirm delivery, Record payment |
| "Something went wrong"           | The business reason and the next action                                |

Words the trade already owns stay unexplained: beat, scheme, case, pieces, MRP, GRN, credit note, godown, claim, batch, expiry.

**Connectivity is stated, never hidden.** Every screen of every app carries one persistent, non-blocking connection strip: "Updated 2 min ago", "3 orders waiting", "Offline since 10:42". When something is waiting, the strip becomes a tappable row that opens the waiting list — **it is never a "Sync now" button**, and connectivity, GPS and permissions never raise a blocking dialog. Data older than four hours is labelled with its age ("Stock as of 9:40 am").

The product is **online-first today; offline arrives for sales and delivery before the pilot** (decided 2026-09-04). The design is already built for it: when offline lands, only the source of the "waiting" count changes — no screen changes.

---

# 7. What we will not do

Walked screen by screen before any module is called stable: a dark navigation rail; cards inside cards; border plus shadow plus radius on one element; breadcrumbs; three-level navigation; a hamburger menu on a desktop viewport; five or more tabs; a big-logo splash. No gradients, glass or neumorphism; no emoji icons or mixed icon sets; no uppercase outside the small tracked eyebrow labels; no floating action button by default; no illustrated empty states; no pill-shaped primary buttons; no dark mode on a field app.

On numbers: no proportional numerals in a column, no mixed precision, no desktop table shrunk onto a phone, no status carried by colour alone, no 3D or rainbow charts, no chart without its range.

On interaction: no "Sync now" button; no blocking modal for sync, GPS or permissions; no `alert()`; no success toast used as the record of a ledger write; no undo on an irreversible ledger write; no hover-only affordance; no geo-fence that blocks work; no permission prompt on first open; **no registration form in front of a retailer**; and never losing a half-typed order to an incoming phone call. The last two decide adoption.

---

# 8. How this is enforced

| Check                                                                                                                                                            | Where it runs                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| No colour literal outside the token file; no direct haptics, chart-library or raw-primitive import in a screen; no animation without a reduce-motion declaration | ESLint                                     |
| Desk-only code forks capped at 18 files across owner + manager                                                                                                   | CI script                                  |
| No purchase-cost string in the sales, warehouse, delivery or retailer bundle                                                                                     | Role-leak check, extended to bundles       |
| Cold start, time-to-interactive, bundle size, day data budget                                                                                                    | CI on the reference device                 |
| Three-tap reorder, three-tap delivery, two-tap retailer reorder                                                                                                  | Automated device flows, fail on regression |
| Screenshots on a 4 GB Android **and** an iPhone, at 100% and 200% font size                                                                                      | Before a module is called stable           |
| The "will not do" list walked; every branded surface shows the distributor's name, never ours                                                                    | Design review, per module                  |

---

# 9. Still open

| Question                                                                                                          | Recommendation                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Typeface: IBM Plex Sans or Inter (as drawn in the mockup)                                                         | Plex — tabular digits, Devanagari sibling                                                                   |
| WhatsApp sender: the distributor's own business account, or one shared number                                     | The distributor's own — it matches white-label                                                              |
| Dark mode for owner and manager                                                                                   | Tokens exist; ship the toggle in v2                                                                         |
| App icons: one shared mark with a role glyph, or seven distinct marks                                             | One shared mark                                                                                             |
| Haptics default                                                                                                   | Full (a per-device setting either way)                                                                      |
| Buy the ₹9,000 reference handset; measure the pilot staff's actual screen brightness; time one rep on a real beat | Do it before the pilot — **none of the performance budgets above are real until measured on a real device** |
| One 12 px desk label is the only text below the 14 px floor, kept for character                                   | Accept, or raise it — one line of code either way                                                           |

---

# Related pages and repository documents

- **Apps & Workflows** — what each of the seven apps does, and who signs in
- **Product Principles** — the twenty principles this system implements visually
- **Decisions Log** — the dated founder decisions register, mirroring `docs/22` §8
- **Build Status & Roadmap** — what is built, what is next
- Repository: `docs/design/UX-00-design-system.md` (the full specification), `UX-01-field-reality.md`, `UX-02-current-standards.md`, `UX-03-technical-constraints.md`, `docs/design/layout-options.html` (the four directions), `docs/23-app-screens-and-api-gaps.md` (the binding screen inventory), `docs/22-source-of-truth.md` (§8 decisions, §9 non-negotiables)
