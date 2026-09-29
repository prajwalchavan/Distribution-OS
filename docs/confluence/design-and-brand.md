# Design System & Brand

## Document Information

| Property     | Value                 |
| ------------ | --------------------- |
| Document     | Design System & Brand |
| Product      | Distribution OS       |
| Version      | 3.1                   |
| Status       | Active                |
| Owner        | Prajwal Chavan        |
| Last Updated | 29 September 2026     |

---

# Purpose

This page states **how Distribution OS looks, reads and feels, and what it is called** — the layout direction, the product brand, the white-label rule, and the evidence-based rules that every screen of the app and of the console is built against.

The six business roles use **one app** — one website and one Android app; the iOS app is built from the same code and is not released yet — and Distribution OS staff use a **separate console**. Every screen of both follows the rules on this page.

---

# The rules that bind every screen

| Area                  | Rule                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout                | **Layout direction A "Ledger"** on every screen of the app; the console uses the desk density of the same system                                                                                                     |
| Product name          | **"Distribution OS"**, in one store listing that becomes the right app after sign-in; the console has its own listing                                                                                                |
| White-label           | Inside the app and on every document the distributor sees their own name and logo, never the product's                                                                                                               |
| Language              | **English only**; the flow must still work for a user who reads no English sentence                                                                                                                                  |
| Connectivity          | **Sales, warehouse and delivery keep working offline**, each device keeping its own copy; the other roles work online                                                                                                |
| Haptics               | **Haptics and "feel good"** are a requirement, not a polish item — with the limits in the Haptics section below                                                                                                      |
| Console               | **"Distribution OS - Admin"**, the platform console for Distribution OS staff, in desk density                                                                                                                       |
| Platforms             | **The app and the console are each one Expo codebase** for web, Android and iOS; the console keeps desk density                                                                                                      |
| Typeface              | **IBM Plex Sans** in the app and the console                                                                                                                                                                         |
| Welcome, then landing | The app opens on a **Welcome** screen carrying the Distribution OS mark; after sign-in it states for two seconds whose business you are in, who you are and which app this is                                        |
| Role at sign-in       | **Role election, downward only** — a device asks for the role it needs; the owner may act as any staff role, the manager as the field roles, everyone else as their own plus the extra roles set on their membership |

---

# 1. Layout: direction A, "Ledger"

Ledger is direction A of the four layout directions drawn for the product — **A Ledger, B Instrument, C Panel, D Signal** — and it is the one every screen is built on.

**A in one sentence:** a well-kept accounts book that answers instantly. A warm off-white page, near-black ink, thin rules instead of boxes, and one deep teal for anything you can act on.

Why Ledger: it feels like the ledger it replaces, so staff trust it on sight; it shows the most numbers per screen of the four; and it ages slowly. **The cost:** it is deliberately plain and will never make anyone say "wow" in a demo.

Five properties a reviewer checks first:

1. The page ground is warm off-white, surfaces are white, and **no card, row, strip, table, chip or input carries a shadow**.
2. Groups are separated by hairlines, never by boxes inside boxes.
3. The only saturated colour that is not a status is the accent (petrol).
4. KPIs are columns of a register strip, not tiles.
5. Charts are 2 px lines on hairline gridlines, with no fills.

## One system, two densities

There are **two densities, not two design systems**. Every colour, type and spacing token is identical on both; what changes is grid density, navigation and primary input.

| Aspect         | Desk — owner, manager + accountant, platform admin                  | Field — sales, warehouse, delivery, retailer                    |
| -------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Primary device | PC at 1366×768; phone secondary                                     | 4 GB / 720p / 4G Android at 5.5–6.6", and its iPhone equivalent |
| Primary input  | Keyboard — no action needs a pointer                                | One right thumb — no action needs two hands                     |
| Density        | 32 px register rows, 14 px cells, 20 px gutters                     | 72–96 dp rows, 16 sp body, 16 dp gutters                        |
| Theme          | Light default; dark tokens defined, dark mode comes after version 1 | **Light only**; never reads system appearance                   |
| Tables         | Real tables: sticky head, frozen first column                       | Grouped list cards. **Never a table**                           |
| Primary action | Page-header right, plus Enter                                       | Bottom third of the screen, above the safe-area inset           |

A desk role's screens opened at phone width get the phone shell. A field role's screens get field tokens and field sizes on every target, the website included — density follows the role and the viewport, never the platform.

**Navigation is two levels maximum on desk:** the left rail is level 1, a page's tab row (four tabs at most) is level 2. A detail opened from a register row is a side panel over that page, not a third level. On phone, sales and warehouse have a four-item tab bar on root screens only; delivery and retailer are single stacks that open on the next stop and the last bill.

---

# 2. Brand: Distribution OS

The product is called **Distribution OS**: an accurate name, and one that reads well to a bank, a brand manager or an investor.

| Element                | Rule                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark               | "Distribution" in the regular weight, "OS" in semibold and the petrol accent, one line, no separate mark, no tagline                               |
| Store listing          | **One listing, "Distribution OS"**, which becomes the right app after sign-in; the platform console keeps its own separate listing                 |
| App names              | The six role names live on **inside** the product — on the landing after sign-in ("Delivery app") — so a person always knows which app they are in |
| Where it appears       | **Only** the Welcome screen, the sign-in screen, the app icon label and the store listing                                                          |
| App icon               | A petrol square with "OS" in white; one icon for the one app, and the console's own beside it                                                      |
| Where it never appears | Inside the app after sign-in; on any invoice, credit note, challan, receipt, statement or WhatsApp message                                         |
| Legibility             | The mark must work at 16 dp, in one colour, and beside any distributor's logo without competing                                                    |

## The Welcome screen

**The app opens on Welcome** — the first screen a device ever shows, and the only place the product introduces itself. It carries four things and nothing else:

1. The **Distribution OS mark**.
2. **One line** saying what the product is.
3. **This app's own name and icon.**
4. One button: **Sign in**, which opens the sign-in form.

**It is shown once per device, not on every launch.** Once a session exists on that phone or browser, the driver at 6 am opens straight into his trip — a welcome screen every morning is a door you have to push through, not a welcome. It is built once in the shared kit and used by the app and the console, and it renders at both phone and desk widths.

**This is not the big-logo splash the "will not do" list forbids** (§7). A splash is an animation that stands between a person and their work on every single launch. Welcome is a door shown once per device, with a button on it, before there is any work to stand in front of.

---

# 3. White-label: whose business is on the screen

**The rule:** inside the app and on every document, the distributor sees and shows _their_ business, never Distribution OS.

**The distributor supplies a name and a logo — never a colour.** A tenant-controlled accent would void every contrast ratio in the system, so brand colour is not configurable. This is a deliberate limit, and it is the answer to "can we make it match our brand colours?".

| Surface                       | What the distributor's user sees                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome, before sign-in       | **Only the product brand** — the mark, the one line, this app's name, one button. No distributor is named before anyone has signed in                                                                                                   |
| Sign-in                       | **Only the product brand**, before authentication — a pre-auth lookup would reveal which distributor a username belongs to                                                                                                              |
| Landing, immediately after    | **The distributor's logo and name, the person's name, and which app this is** — for about two seconds, then the app's home                                                                                                              |
| After sign-in, one membership | Straight into the app; the header carries the distributor's logo and display name                                                                                                                                                       |
| After sign-in, several        | Staff get a memberships picker: one card per distributor, each with that distributor's logo and name. **A shop never does** — it lands in the distributor it dealt with last on that device, and one home shows each distributor's dues |
| App bar / desk rail           | Logo plus display name on every screen                                                                                                                                                                                                  |
| Printed documents             | Header = logo, display name, legal name if different, address, GSTIN, FSSAI; footer = the distributor's own footer line; UPI QR from their VPA                                                                                          |
| Thermal receipts              | Display name, receipt number, amount, bill allocation; no logo on thermal paper                                                                                                                                                         |
| WhatsApp and push             | Sender identity is the distributor's own WhatsApp Business account; the message opens with their display name                                                                                                                           |
| Retailer app                  | The **shop's** name in the header; each distributor card carries that distributor's logo and name                                                                                                                                       |

Branding keys live in `tenant_settings` (display name, logo, invoice footer, address, FSSAI number, UPI VPA), and the owner uploads and previews all sizes in Settings → Branding. The sign-in response carries the distributor's display name and a signed logo URL, so the chrome, the memberships picker, the landing screen and the retailer's distributor cards all show the distributor's own branding.

## The landing screen

**The first thing a signed-in person sees is a statement of where they are**: the distributor's logo and name — the shop's name in the retailer app, "Distribution OS" in the console — the person's own name, and which app this is ("Delivery app"). It holds for about two seconds and then the app's home takes over. There is nothing to tap; it is not a screen a person navigates, it is the answer to "whose business am I in, and as what?" before the first number appears.

Two reasons it earns its two seconds. A shared van phone or a counter browser passes between people, and the person holding it should not have to read a figure to work out whose books they are looking at. And one person may sign in as a different role on different days — the owner driving a van on Tuesday — so **which app, for whom** is not obvious from the icon alone.

White label inside the app holds with both screens: after the landing clears, the product's own name is nowhere on the screen.

---

# 4. The field rules

These come from measured evidence of field conditions, not taste, and they override any visual preference. A screen that breaks one of them is not finished.

| Rule                                                                                                                                                                                                              | Why                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **7:1 contrast for every piece of text in a field app** (WCAG AAA), not 4.5:1                                                                                                                                     | Direct sun is 80,000–200,000 lux; an entry-level 450–600 nit panel has no headroom for subtle greys                    |
| **11 mm (69 dp) minimum tap target** in sales, delivery and retailer; **12 mm (76 dp)** on every warehouse screen and for the delivery stop actions; 10 mm (63 dp) on owner/manager phone surfaces; 24 px on desk | ISO/TS 9241-411 and handheld field studies. Material's 48 dp is 7.6 mm and Apple's 44 pt ≈ 7 mm — both below our floor |
| Gaps: **3 mm between adjacent targets, 4 mm in the warehouse, 8 mm between a confirming and a destructive action**                                                                                                | Rage-taps and mis-taps while standing, walking, wet or in a moving vehicle                                             |
| **Taps only.** No swipe-to-complete, no slide-to-confirm, nothing gestural at all in delivery                                                                                                                     | Gloves, wet hands, one-handed use, and a rider who cannot afford a mis-swipe on a ledger write                         |
| **Light theme only in the field**; never reads system appearance. Dark mode is a desk feature and comes after version 1                                                                                           | Ambient contrast collapses outdoors; a dark screen in sun is unreadable                                                |
| **Device floor: 4 GB RAM, 4G, Android 11+ / iOS 16+, 450–600 nit screen.** Budgets: cold launch ≤ 1.5 s, first render ≤ 2.0 s, tap acknowledged ≤ 100 ms, scroll ≥ 55 fps, a working day ≤ 10 MB of data          | The salesman and the rider buying a ₹9,000–12,000 handset are the actual users; memory prices rose ~4× since 2025      |
| **Money and quantity figures at 20 sp or larger**; body text 16 sp; the one number a screen exists for at 24–44 sp; nothing below 14 sp                                                                           | Outdoor legibility, and the number is the reason the screen exists                                                     |
| **Every primary action sits in the bottom third**; nothing destructive under the resting thumb                                                                                                                    | ~49% of users are one-handed and 67% right-thumbed; bottom placement preserves one-handed reach                        |
| **Colour is never the only channel** — every state is colour plus icon plus word                                                                                                                                  | Colour vision, sunlight, cheap panels                                                                                  |
| **Quantity is never a free text field**, and is always dual-unit ("2 cs + 6 pc = 186 pc"), never toggled                                                                                                          | The trade counts in both units at once                                                                                 |

Two screens are designed to be turned around and shown across a counter — order confirmation and disputed quantity: single column, every figure at 20 sp or larger.

## Colour, type and space, in brief

- **Palette:** a warm paper neutral (ink is a warm near-black), one accent (**petrol**, a deep teal — dark enough for white text at AAA, unclaimed in Indian distribution software, calm beside any distributor's logo), and five status families: moss (positive), ochre (caution), clay, brick (critical) and neutral. Every text pair was computed against WCAG relative luminance, not estimated.
- **Status colour means one thing:** green paid, amber due, red overdue. Ageing runs as one ordered six-rung ladder matching the outstanding ageing buckets 0-7 / 8-15 / 16-30 / 31-60 / 61-90 / 90+.
- **Typeface: IBM Plex Sans**, in the app and the console. Its digits are tabular at every weight with no feature flag that can fail silently on a cheap Android, the rupee glyph is present, and its Devanagari sibling has the identical digit advance — so a Marathi interface would be a font swap, not a redesign.
- **Numbers:** integer paise in and out, Indian grouping (₹1,24,500.00), fixed two decimals down a column, the rupee sign stated once per column, tabular everywhere.
- **Space:** one 4 px scale. Radii are tight (4/6/8/12/20). **Exactly four things carry a shadow** — bottom sheet, dialog, menu, and the sticky bottom bar while content scrolls under it. Everything else is flat.

---

# 5. Motion and haptics

Motion is short and functional: 50–100 ms for press feedback, 150–200 ms for enter/exit, 250–300 ms for sheets and dialogs, and nothing routine over 300 ms. Only transform and opacity animate; every animation respects the operating system's reduce-motion setting; there is no splash animation.

**Haptics** go through one shared façade — `select`, `toggle`, `gestureStart`, `success`, `warning`, `error`, `destructive` — so no screen calls the haptics library directly. Strength scales inversely with frequency. A user setting offers **Full / Important only / Off**, defaulting to Full, per device.

Two honest limits:

1. **On a ₹9,000 handset's actuator, "success" and "error" feel alike.** So a haptic always _confirms a visible state change and is never itself the signal_. The record of what happened is on screen: the outcome word, the invoice or receipt number, the screen advancing.
2. **Web has no haptics.** The app and the console are each one codebase for the website, Android and iOS, so the website is visual-only by design; the phone builds carry the full set.

Order placed, payment collected, delivery confirmed, GRN posted, invoice issued, trip settled and approval granted get `success`. Partial delivery, bargain rejected and settlement variance get `warning`. Credit stop, scan rejected and delivery failed get `error`. Navigation, scrolling, keypad digits, screen loads, toasts and pull-to-refresh get **nothing** — sound is never a channel at all.

**Optimistic UI** is used for what the device can validate by itself (order lines, check-in, visits, drafts, delivery outcomes, receipts with a client receipt number). It is **never** used for confirming an order, issuing an invoice, posting a GRN, closing a trip, approving a credit override, cancelling an invoice, reversing a receipt, a cheque bounce or a write-off: those show determinate progress, carry one idempotency key per user intent, and are never undoable — corrections are credit notes and reversals, which is how the ledger works.

---

# 6. Language and connectivity

**The app is in English only**, with a hard constraint attached: every flow must survive a user who reads no English sentence. Meaning is carried by numbers, icons, the trade's own vocabulary and screen position, not by prose. Marathi and Hindi are a font swap and a string catalogue away by design, not a redesign.

Five writing rules: use the trade's word, not the software's; labels at 20 characters or fewer and buttons as verb + object; never abbreviate money except on a chart axis; state the next action, not the problem; and no exclamation marks, "Oops", "Great job" or emoji anywhere.

| Never say                        | Say                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| COGS, AR, Aging, SKU, ATP, MOV   | Purchase cost, Outstanding, Ageing, Item, Available, Minimum order     |
| POD, PJP, DSO, FEFO              | Delivery proof, Beat plan, Average days to pay, Oldest expiry first    |
| Sync, queue, idempotency; Tenant | "Waiting to send"; the distributor's own name                          |
| Submit, OK, Done, Save           | Place order, Post GRN, Issue invoice, Confirm delivery, Record payment |
| "Something went wrong"           | The business reason and the next action                                |

Words the trade already owns stay unexplained: beat, scheme, case, pieces, MRP, GRN, credit note, godown, claim, batch, expiry.

**Connectivity is stated, never hidden.** Every screen carries one persistent, non-blocking connection strip: "Updated 2 min ago", "3 orders waiting", "Offline since 10:42". When something is waiting, the strip becomes a tappable row that opens the waiting list — **it is never a "Sync now" button**, and connectivity, GPS and permissions never raise a blocking dialog. Data older than four hours is labelled with its age ("Stock as of 9:40 am").

**Sales, warehouse and delivery keep working offline; the other roles work online.** Offline, the device keeps its own copy, changes queue and replay in order, and the strip reports the real queue. Two rules are non-negotiable: **the app never says work is saved on this device when it is not** — a browser that cannot keep a copy says so on _every_ screen, not just the first — and it never says an order reached the office before it did. A device's copy belongs to one person in one distributorship and is deleted at sign-out; unsent changes stay with that person and go first at their next sign-in.

---

# 7. What we will not do

None of these appears on any screen: a dark navigation rail; cards inside cards; border plus shadow plus radius on one element; breadcrumbs; three-level navigation; a hamburger menu on a desktop viewport; five or more tabs; a big-logo splash. No gradients, glass or neumorphism; no emoji icons or mixed icon sets; no uppercase outside the small tracked eyebrow labels; no floating action button by default; no illustrated empty states; no pill-shaped primary buttons; no dark mode on a field app.

On numbers: no proportional numerals in a column, no mixed precision, no desktop table shrunk onto a phone, no status carried by colour alone, no 3D or rainbow charts, no chart without its range.

On interaction: no "Sync now" button; no blocking modal for sync, GPS or permissions; no `alert()`; no success toast used as the record of a ledger write; no undo on an irreversible ledger write; no hover-only affordance; no geo-fence that blocks work; no permission prompt on first open; **no registration form in front of a retailer**; and never losing a half-typed order to an incoming phone call. The last two decide adoption.

Three more are non-negotiable: **sign-out leaves nothing of the previous person or distributor on a device**; **no screen claims work is safe when it is not**; and **money a person has entered is never offered for deletion** — a payment the office refuses is kept and routed to the cashier, not removed.

---

# 8. How this is enforced

| Check                                                                                                                                                            | Where it runs                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| No colour literal outside the token file; no direct haptics, chart-library or raw-primitive import in a screen; no animation without a reduce-motion declaration | ESLint                                     |
| Desk-only code forks capped at 18 files across owner + manager                                                                                                   | CI script                                  |
| No purchase-cost string in the sales, warehouse, delivery or retailer bundle                                                                                     | Role-leak check, extended to bundles       |
| Cold start, time-to-interactive, bundle size, day data budget                                                                                                    | CI on the reference device                 |
| Three-tap reorder, three-tap delivery, two-tap retailer reorder                                                                                                  | Automated device flows, fail on regression |
| Screenshots on a 4 GB Android, at 100% and 200% font size                                                                                                        | Before a screen is released                |
| The "will not do" list walked; every branded surface shows the distributor's name, never Distribution OS                                                         | Design review, per module                  |

---

# Related pages

- **Apps & Workflows** — what each role does in the app, and who signs in
- **Product Principles** — the twenty principles this system implements visually
