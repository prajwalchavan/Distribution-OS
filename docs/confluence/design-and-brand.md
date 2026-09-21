# Design System & Brand

## Document Information

| Property     | Value                 |
| ------------ | --------------------- |
| Document     | Design System & Brand |
| Product      | Distribution OS       |
| Version      | 3.0                   |
| Status       | Active                |
| Owner        | Product Management    |
| Last Updated | 21 September 2026     |

---

# Purpose

This page states **how Distribution OS looks, reads and feels, and what it is called** — the layout direction, the product brand, the white-label rule, and the evidence-based rules that every screen in every app is built against.

**This is no longer a contract for screens about to be written — it is the rule set the built screens are held to.** The backend was built first by founder decision (2026-09-04) and completed on 2026-09-06; **all seven apps were built and gated green on 2026-09-07**, each one Expo codebase serving website + Android + iOS, each walked screen by screen at desk and phone widths against the live services before it was called done. Since then the product has been through two QA batches; as at 2026-09-21, 153 of 158 batch-2 findings are merged and the programme is a **seven-day run to go live on Saturday 27 September** (`QA/10-DAY-PLAN.md`). Build Status & Roadmap carries the current numbers and mirrors `docs/18-build-log.md`; treat any figure quoted here as a snapshot of its date.

**Two changes to the sign-in surface are in flight this week** and both touch this page: **role election** at sign-in (a device asks for the role it needs; granted only downward), and the merge of the six business apps into **one app that is one website, one Android app and one iOS app**. Both are decided (2026-09-21) and land before go-live. What they change is described in §2 and §3; nothing in the layout, colour, type, field or motion rules moves with them.

**Source of truth.** `docs/22-source-of-truth.md` in the repository is the master document; the full design specification is `docs/design/UX-00-design-system.md`, built on three evidence files (`UX-01` field reality, `UX-02` current standards, `UX-03` technical constraints) and the four layout mockups in `docs/design/layout-options.html`. This page summarises them for readers who will not open 900 lines of specification. Where this page and the repository disagree, **the repository wins**.

---

# The decisions that bind every screen

| Decided    | Decision                                                                                                                                                                  | Where it lives                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 2026-09-05 | **Layout direction A "Ledger"** chosen from four mockups; applies to all six role apps (the admin console adopts the desk density of the same system when it is designed) | UX-00 §1, `layout-options.html` |
| 2026-09-05 | **Product name is "Distribution OS"**; apps are "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer". **The per-app store names are SUPERSEDED by the 2026-09-21 one-listing row below**; the product name itself stands | UX-00 §10                       |
| 2026-09-04 | **White-label**: inside every app and on every document the distributor sees their own name and logo, never ours                                                          | UX-00 §11, `tenant_settings`    |
| 2026-09-04 | **English only for now**; the flow must still work for a user who reads no English sentence                                                                               | UX-00 §12                       |
| 2026-09-04 | **Online-first now; offline for sales and delivery before the pilot**                                                                                                     | UX-00 §6.11, ADR 0007           |
| 2026-09-04 | **Haptics and "feel good"** are a requirement, not a polish item — with the limits in the Haptics section below                                                           | UX-00 §7                        |
| 2026-09-04 | Every app ships **web + Android + iOS** from one codebase (the seventh, platform-admin app is web only)                                                                   | UX-00 §2                        |
| 2026-09-05 | **Seventh app**: "Distribution OS - Admin", the platform console, web only, desk density                                                                                  | `docs/22` §2 and §8             |
| 2026-09-05 | **Typeface confirmed: IBM Plex Sans** for all seven apps — the last open design token, closed by the founder                                                              | `docs/22` §8                    |
| 2026-09-06 | **Every app is universal, the console included** — one Expo codebase per app for web + Android + iOS. The "web only" clause in the two rows above is **superseded**; the console keeps desk density | `docs/22` §2 and §8, `docs/08` §0 |
| 2026-09-07 | **All seven apps are built and gated green** — every screen of the inventory walked at desk and phone widths against the live services before an app was called done      | `docs/18-build-log.md`          |
| 2026-09-21 | **Welcome, then landing.** Every app opens on a Welcome screen carrying the Distribution OS mark; after sign-in it states for two seconds whose business you are in, who you are and which app this is | `docs/22` §8, `docs/29` §1      |
| 2026-09-21 | **One store listing, "Distribution OS"**, which becomes the right app after sign-in — **supersedes** the six per-role store names of 2026-09-05. The console keeps its own listing | `docs/22` §8, `docs/29` §3      |
| 2026-09-21 | **Role election at sign-in, downward only** — a device asks for the role it needs; the owner may act as any staff role, the manager as the field roles, everyone else as their own plus the extra roles set on their membership | `docs/22` §8, `docs/29` §2      |

---

# 1. Layout: direction A, "Ledger"

Four directions were drawn as working mockups — **A Ledger, B Instrument, C Panel, D Signal** — and the founder picked one letter on 2026-09-05, **ahead of** the original "after the backend is complete" sequencing (decided 2026-09-04), so that design work was unblocked. All seven apps were then built on direction A and gated green by 2026-09-07; everything below describes screens that exist.

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
| Store listing          | **ONE listing, "Distribution OS"** (decided 2026-09-21), which becomes the right app after sign-in; the platform console keeps its own separate listing. This supersedes the six per-role store names "Distribution OS - Owner / - Manager / - Sales / - Warehouse / - Delivery / - Retailer" decided 2026-09-05 |
| App names              | The six role names live on **inside** the product — on the Welcome screen ("Delivery") and on the landing after sign-in ("Delivery app") — so a person always knows which app they are in. They are no longer six things to find in a store |
| Where it appears       | **Only** the Welcome screen, the sign-in screen, the app icon label and the store listing                                                   |
| App icon               | A petrol square with "OS" in white; one icon for the one app, and the console's own beside it. (Until the merge lands, the built apps still carry the shared silhouette with a role glyph) |
| Where it never appears | Inside any app after sign-in; on any invoice, credit note, challan, receipt, statement or WhatsApp message                                  |
| Legibility             | The mark must work at 16 dp, in one colour, and beside any distributor's logo without competing                                             |

The role name follows the mark on the Welcome screen, the sign-in screen and the store listing only.

## The Welcome screen (decided 2026-09-21)

**Every app opens on Welcome** — the first screen a device ever shows, and the only place the product introduces itself. It carries four things and nothing else:

1. The **Distribution OS mark**.
2. One line: **"Connecting a distribution business through six apps."**
3. **This app's own name and icon** — "Delivery", "Sales", "Owner".
4. One button: **Sign in**, which opens today's sign-in form unchanged.

**It is shown once per device, not on every launch.** Once a session exists on that phone or browser, the driver at 6 am opens straight into his trip — a welcome screen every morning is a door you have to push through, not a welcome. It is built once in the shared kit and used by all seven apps, so the seven are identical rather than seven near-copies, and it renders at both phone and desk widths.

The founder's words: _"Each app will open with welcome image of Distribution OS … then will have login button … it will show what app it is and for which tenant or shop keeper etc with its logo and name."_ The second half of that sentence is the landing, in §3.

**This is not the big-logo splash the "will not do" list forbids** (§7). A splash is an animation that stands between a person and their work on every single launch. Welcome is a door shown once per device, with a button on it, before there is any work to stand in front of.

---

# 3. White-label: whose business is on the screen

**The rule (a non-negotiable, `docs/22` §9 item 10):** inside every app and on every document, the distributor sees and shows _their_ business, never ours.

**The distributor supplies a name and a logo — never a colour.** A tenant-controlled accent would void every contrast ratio in the system, so brand colour is not configurable. This is a deliberate limit, and it is the answer to "can we make it match our brand colours?".

| Surface                       | What the distributor's user sees                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome, before sign-in       | **Only the product brand** — the mark, the one line, this app's name, one button. No distributor is named before anyone has signed in          |
| Sign-in                       | **Only the product brand**, before authentication — a pre-auth lookup would reveal which distributor a username belongs to                     |
| Landing, immediately after    | **The distributor's logo and name, the person's name, and which app this is** — for about two seconds, then the app's home (decided 2026-09-21) |
| After sign-in, one membership | Straight into the app; the header carries the distributor's logo and display name                                                              |
| After sign-in, several        | Staff get a memberships picker: one card per distributor, each with that distributor's logo and name. **A shop never does** — it lands in the distributor it dealt with last on that device, and one home shows each distributor's dues (decided 2026-09-13) |
| App bar / desk rail           | Logo plus display name on every screen                                                                                                         |
| Printed documents             | Header = logo, display name, legal name if different, address, GSTIN, FSSAI; footer = the distributor's own footer line; UPI QR from their VPA |
| Thermal receipts              | Display name, receipt number, amount, bill allocation; no logo on thermal paper                                                                |
| WhatsApp and push             | Sender identity is the distributor's own WhatsApp Business account; the message opens with their display name                                  |
| Retailer app                  | The **shop's** name in the header; each distributor card carries that distributor's logo and name                                              |

Branding keys live in `tenant_settings` (display name, logo, invoice footer, address, FSSAI number, UPI VPA), and the owner uploads and previews all sizes in Settings → Branding. **This is now complete, not partial:** the branding read, the settings read and write, and the logo upload were built in the backend gap slice, and the sign-in response carries the distributor's display name and a signed logo URL — so the chrome, the memberships picker, the landing screen and the retailer's distributor cards all show real branding rather than a fallback (`docs/23` §8.12–§8.13, both DONE).

## The landing screen (decided 2026-09-21)

**The first thing a signed-in person sees is a statement of where they are**: the distributor's logo and name — the shop's name in the retailer app, "Distribution OS" in the console — the person's own name, and which app this is ("Delivery app"). It holds for about two seconds and then the app's home takes over. There is nothing to tap; it is not a screen a person navigates, it is the answer to "whose business am I in, and as what?" before the first number appears.

Two reasons it earns its two seconds. A shared van phone or a counter browser passes between people, and the person holding it should not have to read a figure to work out whose books they are looking at. And from the week role election lands, one person may sign in as a different role on different days — the owner driving a van on Tuesday — so **which app, for whom** stops being obvious from the icon alone.

White label inside the app is unchanged by both screens: after the landing clears, the product's own name is nowhere on the screen, exactly as the non-negotiable requires.

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
- **Typeface: IBM Plex Sans**, confirmed by the founder on 2026-09-05 and shipped in all seven apps. Chosen because its digits are tabular at every weight with no feature flag that can fail silently on a cheap Android, the rupee glyph is present, and its Devanagari sibling has the identical digit advance — so a later Marathi pass is a font swap, not a redesign.
- **Numbers:** integer paise in and out, Indian grouping (₹1,24,500.00), fixed two decimals down a column, the rupee sign stated once per column, tabular everywhere.
- **Space:** one 4 px scale. Radii are tight (4/6/8/12/20). **Exactly four things carry a shadow** — bottom sheet, dialog, menu, and the sticky bottom bar while content scrolls under it. Everything else is flat.

---

# 5. Motion and haptics

Motion is short and functional: 50–100 ms for press feedback, 150–200 ms for enter/exit, 250–300 ms for sheets and dialogs, and nothing routine over 300 ms. Only transform and opacity animate; every animation respects the operating system's reduce-motion setting; there is no splash animation.

**Haptics** (founder requirement, 2026-09-04) go through one shared façade — `select`, `toggle`, `gestureStart`, `success`, `warning`, `error`, `destructive` — so no screen calls the haptics library directly. Strength scales inversely with frequency. A user setting offers **Full / Important only / Off**, defaulting to Full, per device.

Two honest limits:

1. **On a ₹9,000 handset's actuator, "success" and "error" feel alike.** So a haptic always _confirms a visible state change and is never itself the signal_. The record of what happened is on screen: the outcome word, the invoice or receipt number, the screen advancing.
2. **Web has no haptics.** Every app ships as web + Android + iOS from one codebase, and the website is therefore visual-only by design; the phone builds carry the full set. Android is walked on every pass; **iOS is validated completely once, at the end** (decided 2026-09-21), which is where the remaining device proof sits.

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

The product was **online-first with offline promised for sales and delivery before the pilot** (decided 2026-09-04). **The offline client is now built** (`docs/27`): the field apps keep their own copy on the device, changes queue and replay in order, and the strip reports the real queue. Two rules came out of building it, and both are now non-negotiable: **the app never says work is saved on this device when it is not** — a browser that cannot keep a copy says so on _every_ screen, not just the first — and it never says an order reached the office before it did. A device's copy belongs to one person in one distributorship and is deleted at sign-out; unsent changes stay with that person and go first at their next sign-in.

---

# 7. What we will not do

Walked screen by screen before any module is called stable: a dark navigation rail; cards inside cards; border plus shadow plus radius on one element; breadcrumbs; three-level navigation; a hamburger menu on a desktop viewport; five or more tabs; a big-logo splash. No gradients, glass or neumorphism; no emoji icons or mixed icon sets; no uppercase outside the small tracked eyebrow labels; no floating action button by default; no illustrated empty states; no pill-shaped primary buttons; no dark mode on a field app.

On numbers: no proportional numerals in a column, no mixed precision, no desktop table shrunk onto a phone, no status carried by colour alone, no 3D or rainbow charts, no chart without its range.

On interaction: no "Sync now" button; no blocking modal for sync, GPS or permissions; no `alert()`; no success toast used as the record of a ledger write; no undo on an irreversible ledger write; no hover-only affordance; no geo-fence that blocks work; no permission prompt on first open; **no registration form in front of a retailer**; and never losing a half-typed order to an incoming phone call. The last two decide adoption.

Three more were added by what QA found, and they are now non-negotiables (`docs/22` §9): **sign-out leaves nothing of the previous person or distributor on a device**; **no screen claims work is safe when it is not**; and **money a person has entered is never offered for deletion** — a payment the office refuses is kept and routed to the cashier, not removed.

---

# 8. How this is enforced

| Check                                                                                                                                                            | Where it runs                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| No colour literal outside the token file; no direct haptics, chart-library or raw-primitive import in a screen; no animation without a reduce-motion declaration | ESLint                                     |
| Desk-only code forks capped at 18 files across owner + manager                                                                                                   | CI script                                  |
| No purchase-cost string in the sales, warehouse, delivery or retailer bundle                                                                                     | Role-leak check, extended to bundles       |
| Cold start, time-to-interactive, bundle size, day data budget                                                                                                    | CI on the reference device                 |
| Three-tap reorder, three-tap delivery, two-tap retailer reorder                                                                                                  | Automated device flows, fail on regression |
| Screenshots on a 4 GB Android, at 100% and 200% font size                                                                                                        | Before a module is called stable           |
| The same on an iPhone — **one complete pass at the end**, not per lane (decided 2026-09-21); until then a device walk is a short sanity check and no finding waits on a phone | Final device validation, both platforms    |
| The "will not do" list walked; every branded surface shows the distributor's name, never ours                                                                    | Design review, per module                  |

---

# 9. Still open

| Question                                                                                                          | Recommendation                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| WhatsApp sender: the distributor's own business account, or one shared number                                     | The distributor's own — it matches white-label                                                              |
| Dark mode for owner and manager                                                                                   | Tokens exist; ship the toggle in v2                                                                         |
| The one app's icon, now that there is one listing and not six                                                     | One mark, no role glyph — the app tells you which app it is on Welcome and on landing                       |
| Is the field touch floor a **height** or a **size**? The specification fixes chip height, so a 68 × 76 dp chip is legal and still under 12 mm across (raised by the warehouse gate) | Read it as a size on warehouse actions; one line either way                                                 |
| May the warehouse gate-count pad **scroll** on a phone? The specification calls it "the full-screen pad"          | Allow the scroll; a phone cannot hold the pad and the keypad at 76 dp otherwise                             |
| Haptics default                                                                                                   | Full (a per-device setting either way)                                                                      |
| Buy the ₹9,000 reference handset; measure the pilot staff's actual screen brightness; time one rep on a real beat | Do it before the pilot — **none of the performance budgets above are real until measured on a real device** |
| One 12 px desk label is the only text below the 14 px floor, kept for character                                   | Accept, or raise it — one line of code either way                                                           |

---

# Related pages and repository documents

- **Apps & Workflows** — what each of the seven apps does, and who signs in
- **Product Principles** — the twenty principles this system implements visually
- **Decisions Log** — the dated founder decisions register, mirroring `docs/22` §8
- **Build Status & Roadmap** — what is built, what is next
- Repository: `docs/design/UX-00-design-system.md` (the full specification), `UX-01-field-reality.md`, `UX-02-current-standards.md`, `UX-03-technical-constraints.md`, `docs/design/layout-options.html` (the four directions), `docs/23-app-screens-and-api-gaps.md` (the binding screen inventory), `docs/29-sign-in-roles-and-one-store-app.md` (Welcome, landing, role election, the one app), `docs/22-source-of-truth.md` (§8 decisions, §9 non-negotiables)
