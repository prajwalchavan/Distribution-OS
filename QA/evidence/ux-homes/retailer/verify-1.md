# Blind check 1 — lane "retailer" (shopkeeper home as a shop front)

Branch `ux/home-retailer`, worktree `.claude/worktrees/ux-retailer`, head `ca276a87` (worktree clean, nothing edited,
nothing committed by this check). Demo API `http://127.0.0.1:3700`, database `dos_test_ux` (read-only SQL). Web export
served on :5730, headless Chromium on :9730. Date 2026-09-28.

This check ran in two sittings: the first (10:26–10:50, screenshots `v1-*`) was cut off when the app quit; this report
is the second sitting (10:51–11:15, screenshots `v2-*`), which re-ran every gate from scratch and redid every check.

**Verdict: FAIL** — one blocker (a gate fails when run without the turbo cache) and one major (the phone's first
screen shows no product that can be added).

---

## 1. Gates (run in the worktree, `frontend/`)

| Gate | Command | Result |
| --- | --- | --- |
| format | `pnpm format:check` | 0 — "All matched files use Prettier code style!" |
| lint | `pnpm lint --force` | 0 — 6/6 tasks, 0 cached |
| typecheck | `pnpm typecheck --force` | 0 — 6/6 tasks, 0 cached |
| test | `pnpm test --force` | **1 — `@dos/offline#test` FAILED** (1 failed / 110). ui 503/503, api-client 130/130, admin-app 14/14 passed; dos-app was cut off by turbo and was run on its own: 129 files, 663/663 passed |
| web export | `expo export --platform web` (run at 10:32 in the first sitting from this same head; log `scratchpad/retailer/export.log`, `EXPORT_EXIT=0`, 4 web bundles) | 0. Bundle grepped: no `distributionos.in`; only `http://127.0.0.1:3700` and `http://127.0.0.1:3700/auth` |

Logs: `scratchpad/retailer/v-format.log`, `v-lint.log`, `v-typecheck.log`, `v-test.log`, `v-offline179.log`,
`v-dosapp-test.log`.

### The failing test (BLOCKER)

`frontend/libs/offline/src/dos-179-keep-claims.guard.test.ts` › "DOS-179 every phone-word string in every app is
classified, and every keep claim is routed":

```
+ { "app": "retailer", "key": "me.signOutTitle", "wrong": "unclassified device claim: Sign out on this phone?" }
+ { "app": "retailer", "key": "me.signOutBody",  "wrong": "unclassified device claim: Your basket on this phone is emptied. Orders you have placed stay with" }
```

Both strings are new in this lane (`frontend/dos-app/src/groups/retailer/strings.ts`, the Me page's sign-out dialog).
Re-run alone (`pnpm --filter @dos/offline test -- src/dos-179-keep-claims.guard.test.ts`): same failure, deterministic.

Why the builder's report says `pnpm test` 0: its own log `scratchpad/retailer/g-test.log` shows
`@dos/offline:test: cache hit, replaying logs 3d076e492528b24e` — the offline guard reads the dos-app strings, which
are outside the offline package's turbo inputs, so the cache replayed a pass from before the strings existed.

The failure is also visible: at 1280 in a desktop browser the Me page's dialog reads "Sign out on this phone? Your
basket on this phone is emptied." (`v2-36-me-signout-dialog-1280.png`) — the device claim DOS-179 exists to stop.

---

## 2. What was checked, and what was measured

Shop logins: `suresh.chauhan` (one distributor, Kalyan Agencies, has past orders), `ramesh.gupta` (Tarsun, Sai,
Kalyan), `fatima.shaikh` (Tarsun, Sai; old last order, for the re-pricing check).

### (1) First screen at 390 × 844 — MAJOR

Measured with element rectangles (`vshot.sh`) after the home settled:

| Login | First tile top | Fold (tab bar top) | Tiles visible | Tiles complete | "+ Add" visible | Brand tiles visible | Money line top |
| --- | --- | --- | --- | --- | --- | --- | --- |
| suresh (Kalyan) | 595 px | 774 px | 2 (top 179 of 257 px: name, size, rate, MRP) | 0 | 0 (Add at 783–852) | 0 (row at 1557) | 1969 |
| ramesh (Tarsun) | 632 px | 774 px | 2 (top 142 px: letter block, name, size; no price) | 0 | 0 | 0 (row at 1582) | 1996 |

Above the tiles, top to bottom: an 86 px header that holds only "⋯", a 28 px "Updated just now" strip, the distributor
chip, a 69 px "Search items" box, and a 178 px "Your last order" card with a full-width "Order again" button, then the
"Your items / See all items" heading. Money is NOT first (it is ~1970 px down). Screenshots:
`v2-01-suresh-home-390.png`, `v2-14-ramesh-tarsun-home-390.png`.

At 1280 × 800 the same home shows 5 complete tiles with their "+ Add" buttons (`v2-27-ramesh-home-1280.png`).

Judged against the founder's words ("the feel of a shopping app … large + buttons"): on the phone nothing on the first
screen can be put in the basket; the shopkeeper must scroll before the first "+ Add". The builder already listed the
empty phone header as a kit follow-up; with it and a one-row last-order card the tiles would clear the fold.

### (2) A fresh order of three items from the home — PASS

suresh, empty basket. Taps: "+ Add" ×3 on the "Your items" tiles (the first Add is already below the fold, so one
scroll before it and one more for the third tile), "See order" on the cart bar, "Place order" = **5 taps**, no confirm
(the order screen had none before either: `base-order.tsx` has no Dialog on place). Cart bar: "3 items ₹1,993.00".
Order screen: Before offers ₹1,534.32, GST ₹458.38, Rounding ₹0.30, You pay ₹1,993.00. Landed on SO-0187 with the
toast "Order SO-0187 is with Kalyan Agencies." (`v2-02`, `v2-03`, `v2-04`).

```sql
select o.order_no, t.slug, o.state, o.source, o.subtotal_paise, o.tax_paise, o.cess_paise, o.round_off_paise, o.total_paise, u.username
  from sales_orders o join tenants t on t.id=o.tenant_id join users u on u.id=o.created_by
 where o.order_no='SO-0187' and t.slug='kalyan-agencies';
-- SO-0187 | kalyan-agencies | submitted | retailer_app | 153432 | 45838 | 9939 | 30 | 199300 | suresh.chauhan
select l.line_no, pv.name, l.entered_qty, l.entered_unit, l.pack_size_at_entry, l.qty_pcs, l.rate_paise, l.line_total_paise ...
-- 1 | Campa Cola 750 ml                | 1 | case | 24 | 24 | 2309 | 77582
-- 2 | Campa Lemon 200 ml               | 1 | case | 48 | 48 |  571 | 38371
-- 3 | Balaji Simply Salted Wafers 45 g | 1 | case | 48 | 48 | 1471 | 83317
```

Pieces and rates equal the tiles (₹23.09, ₹5.71, ₹14.71 a piece); line totals equal the order screen (₹775.82,
₹383.71, ₹833.17); total 199300 paise = the cart bar's ₹1,993.00 to the paisa.

The write is the old screen's write: same `orders.create` + `orders.submit`, same `enteredFor` rule (whole cases when
pieces divide by the case size, else pieces), now applied at place time by `toOrderLines` from today's case size.

### (3) "Order again" — PASS

suresh: "Your last order · 3 items, about ₹1,993 at today's prices" → "Order again" (tap 1) opened `/order?repeat=…`
with the three lines → "Place order" (tap 2) = SO-0188, identical lines to SO-0187, 199300 paise (`v2-06`, `v2-07`).

Re-pricing: the basket carries only `{variantId, qtyPcs}` and `orders.create` receives no rate, so the server prices
at today's terms. Seen in data with fatima (Tarsun): last order SO-0875 of 12 Sep was ₹1,01,531.00 with scheme
discounts on every line; the home card read "10 items, about ₹1,07,984 at today's prices" and the order screen
"Offers ₹0.00 … You pay ₹1,07,984.00" (`v2-38-fatima-order-again-390.png`) — priced today, not copied. (Not placed;
"Empty this order" cleared it.)

### (4) The basket survives — PASS

suresh: "+ Add" on two home tiles → "2 items ₹3,067.00"; Annapurna brand page, "+ Add" on Besan 1 kg → "3 items
₹4,353.00"; Orders tab (no bar there), back to Shop → "3 items ₹4,353.00"; page reload → "3 items ₹4,353.00", stored
as `dos.retailer.cart.<user>.<tenant>` = `{"v":1,"l":[[a511570f…,30],[f086f3e3…,24],[3cf56ead…,12]]}`. See order →
Place order = SO-0189: 3 lines (Balaji Ratlami Sev 1 case, Campa Cola 1 L 1 case, Annapurna Besan 1 kg 1 case),
435300 paise = ₹4,353.00. Back on the home: no cart bar, no cart key in storage (`v2-08`, `v2-09`, `v2-10`, `v2-11`).

List does not jump: scrolled to 700 px, "+ Add" on a tile: scrollTop 700 → 700, tile top 213 → 213; the tile turned
into the stepper in place, the bar appeared; no toast (nothing is written to the server) (`v2-31`, `v2-32`).

### (5) One basket per distributor — PASS

ramesh at Tarsun: + Campa Cola 750 ml, + Balaji Ratlami Sev → "2 items ₹2,866.00". Change → Kalyan Agencies → "Buy
from here": no bar, and the SAME two items (global variants f71bf137, a511570f, both on Kalyan's list) show "+ Add",
not a stepper — nothing leaked. + Campa Orange 750 ml at Kalyan → "1 item ₹772.00", a second key. Back to Tarsun →
"2 items ₹2,866.00". Placed = SO-0893:

```
SO-0893 | tarsun | retailer 34191c43… | submitted | ramesh.gupta | Campa Cola 750 ml 1 case 24 pc @2297 | Balaji Ratlami Sev 200 g 1 case 30 pc @5916 | 286600
```

Tenant tarsun, only the Tarsun basket's items; the Kalyan key stayed. Later, with baskets at Kalyan (1 item) and Sai
(2 items) stored, Me → Sign out → confirm: storage left `dos.device`, `dos.lastRole`, `dos.lastTenantId` only.
The ⋯ menu's "Sign out" also emptied the basket, but with no confirm (see minors). (`v2-15`, `v2-16`, `v2-17`.)

### (6) Search — PASS

Tarsun, "toothp" → "3 items match" (Neelam Herbal Toothpaste 50 g / 200 g / 100 g); "+ Add" on the first → "1 item
₹2,741.00" (`v2-18`, `v2-19`).

### (7) Brand page — PASS

Kalyan, Annapurna tile ("31 items") → `/retailer/brand/7845dad6…`: 31 tiles, every one "Annapurna …" (`v2-08`).

### (8) Pieces and the old guards — PASS

"Pieces" is on every tile once it holds something (and on every order-screen row). Tile → Pieces → pad
(`r2-pieces-input`, inputmode decimal) → 10 → "Set pieces": tile "10 pc", bar "1 item ₹286.00"; placed = SO-0894:
`Neelam Herbal Toothpaste 50 g | 10 | piece | pack 1 | 10 pc | 2420 | 28556 | total 28600` (`v2-20`, `v2-21`).
To enter under a case from the home the shop taps "+ Add" first (adds a case), then Pieces.

Guards run by name: `libs/ui` dos-101, dos-105, dos-124, dos-144, dos-154 — 5 files, 22 tests passed; `dos-app`
dos-102 ×3 — 3 files, 10 tests passed. dos-105/124/144/154 and dos-102-last-distributor are unchanged by the lane;
dos-101 and two dos-102 guards were changed — read in full: they follow the moved code and add assertions; none
removed.

### (9) Pay now — PASS (with a note)

ramesh at Sai: money line "You owe ₹26,470.00 [Pay now]" → `/retailer/pay`, bottom "You pay ₹26,470.00", seven bills
listed. SQL (invoice total minus allocations, open > 0, ramesh's Sai shop): SAI/0081 1,161.00 + 0254 4,287.00 + 0280
3,847.00 + 0363 4,579.00 + 0382 1,845.00 + 0394 4,541.00 + 0419 6,210.00 = ₹26,470.00. Right amount.
Note: the amount field's VALUE is `26470.00` before anything is typed (helper "Leave it as it is to pay everything
you owe") — DOS-154 behaviour, `pay.tsx` unchanged by this lane (`v2-25-pay-390.png`).

### (10) Nothing of the old home is gone — PASS

| Old home (base `46b13020` `app/retailer/index.tsx`) | Now |
| --- | --- |
| Bottom bar "You owe ₹X · Pay now" (`r2-pay`) | Money line after the products (`r2-money`, `r2-pay`) + Money tab "Pay everything" |
| Bottom bar "Order again" (`r2-order-again`) + its sentence | "Your last order" card, "Order again" / "Add last order", "{n} items, about ₹X at today's prices" |
| "Your distributors" panel: total across, per-distributor owed, last bill, unread, van, Call, WhatsApp, "Open {name}" | Chip → sheet (`distributors.tsx`, same cards, "Buy from here") and the Me page |
| No-shop panel (`r2-unlinked`) | Kept on the home |
| Four figures: your shop, overdue, bills to pay, last bill (`r2-kpis`) | More (closed) |
| Last payment line (`r2-last-paid`) | More |
| Next delivery panel (stop, bill, ETA; "No delivery") | "On the way · expected …" / "At your shop now" card (opens the order; checked: SO-0171) — only when a stop is open, the "nothing coming" line is no longer on the home; each order's state is on Orders |
| Recent orders + "Start a new order" | More "Last orders" + "See all orders"; "See all items" and the cart bar open `/order` |
| Call / WhatsApp the open distributor | Sheet card and More "Call or message" |

Navigation: phone tabs Shop · Orders · Money · Me; ⋯ sheet and desk MORE: Offers, Bills, Payments, Account book,
Returns and help, Messages, Shop details, Phones and login (+ Change your password, Sign out). Every link on the home
was clicked: last-order body → the order, See all items → `/order`, offer card and See all offers → `/deals`, van card →
the order, Money and Orders tabs open (`v2-37-*`).

### (11) Backend and routes — PASS

`git diff --name-only 46b13020 ca276a87 -- backend` → 0 files. `git diff --name-status`: only `A` and `M`, no `D`/`R`
(new routes `app/retailer/brand/[id].tsx`, `app/retailer/profile.tsx`).

### (12) No credit limit, no cost — PASS

Nine pages visited (home, brand, order, orders, dues, profile, pay, deals, shop) with every :3700 response body
scanned for keys matching creditLimit / creditAvailable / cost / margin / landed: 60 responses, 0 hits. Page text: no
"credit limit / available credit / cost / margin / landed" except the pre-existing sentence on Shop details ("Your
terms, tier and credit limit are set by {name} and cannot be changed here.", no figure).

### Rule 8 (web and native)

`JobCard, JobList, MoreGroup, ProductTile, TileGrid, BrandTile, CartBar` each exported once from `web/` and once from
`native/`, both entry points; ui parity tests pass (503/503). Native NOT RUN (8 GB rule).

---

## 3. Would a first-time shopkeeper know what to do in five seconds?

Phone: mostly yes for a repeat buyer — the biggest thing on the first screen is "Your last order … Order again", which
is the most common job, and "Search items" is plain. What gets in the way: the empty 86 px header; the product tiles
cut off with no "+ Add" in view; letter blocks ("C", "B") read as missing pictures; after "+ Add" the tile shows "−" and
"+" with no number between them and a bold "1 cs = 48 pc · 19 cs available" line that wraps; "More 3" does not say
what the 3 is. Desk: yes — five items with large "+ Add" buttons on the first screen, rail words are plain.

---

## 4. Findings

**Blocker**
- B1 `pnpm test` fails without the turbo cache: DOS-179 guard (`libs/offline/src/dos-179-keep-claims.guard.test.ts`)
  refuses `me.signOutTitle` / `me.signOutBody` ("on this phone"); the builder's pass was a cache replay; the desktop
  dialog says "this phone".

**Major**
- M1 390 × 844 first screen: 2 tiles peek (179 px / 142 px), 0 complete tiles, 0 "+ Add", 0 brand tiles above the fold.

**Minor**
- m1 Pay screen opens with the whole dues as the amount field's value (pre-existing DOS-154, not changed here); the
  brief's rule 3 ("money never pre-filled") reads against it — architect to rule whether it extends to this screen.
- m2 ⋯ menu "Sign out" empties every basket with no confirm; Me's "Sign out" warns first. One path loses a basket
  silently.
- m3 Tiles show no stock before "+ Add": "Annapurna Basmati Classic 1 kg" (Out of stock on the order screen) and
  "Besan 1 kg" (4 pc left) carry a normal "+ Add"; after it the tile says "Only 0 cs available — rest short-supplied"
  (jargon; "0 cs" while 4 pieces exist). The order screen does show it before placing.
- m4 Tile stepper has no number between − and +; the order-screen stepper shows "0 cs" for a 10-piece line.
- m5 Words: "More 3"; Money page still "PAST ITS DATE" where More says "Overdue"; the Orders tab opens "My orders";
  "cs"/"pc" on tiles.
- m6 Sheet title wraps "Your / distributors" at 390 and 1280; Close floats mid-width at 1280 (declared).
- m7 Home cold load: 17 requests (16 reads + refresh), incl. `orders/last-placed` and 5 `orders/{id}` for "Your items"
  (declared backend gap).
- m8 UX-00 §8.2 and docs/23 §6 still say the retailer has no tab bar (declared, docs not edited).
- m9 Process: the builder reports its first export sent a CORS preflight to api.distributionos.in (hard rule); this
  check's bundle is clean.

**Not tested**
- Android / iOS (8 GB rule): not built, not run; SecureStore size past ~45 basket items not tried.
- The "about ₹…" cart-bar state while a quote is in flight was not caught on screen (only settled totals were read).

---

## 5. Data written to dos_test_ux by this check

Orders (all `retailer_app`, submitted): SO-0185, SO-0186 (first sitting, suresh, Kalyan), SO-0187, SO-0188, SO-0189
(suresh, Kalyan), SO-0893, SO-0894 (ramesh, Tarsun). No other rows (sign-ins and `auth.switchTenant` tokens only).

## 6. Screenshots (this folder)

`v2-01` suresh home 390 · `v2-02` three added · `v2-03` order screen · `v2-04` SO-0187 placed · `v2-05` home after ·
`v2-06`/`v2-07` order again → SO-0188 · `v2-08` brand page · `v2-09` Orders tab · `v2-10` after reload · `v2-11`
SO-0189 · `v2-12` Me · `v2-13` sign-out dialog 390 · `v2-14` ramesh home 390 · `v2-15` chip sheet 390 · `v2-16` Kalyan
home · `v2-17` back to Tarsun · `v2-18`/`v2-19` search · `v2-20`/`v2-21` pieces pad and order · `v2-22`/`v2-23` Sai
home and order again · `v2-24` money line · `v2-25` pay · `v2-26` sign-in 1280 · `v2-27` home 1280 · `v2-28` chip
sheet 1280 · `v2-29`/`v2-30-*` Kalyan home 1280 with More · `v2-31`/`v2-32` add while scrolled · `v2-33-*` Kalyan
home 390 full · `v2-34`/`v2-35` ⋯ sheet and its sign-out · `v2-36` Me sign-out dialog 1280 · `v2-37-*` home links
and tabs · `v2-38` fatima order again. `v1-*`: the first sitting.

Processes started by this check (static server :5730, browser :9730) were stopped before reporting.
