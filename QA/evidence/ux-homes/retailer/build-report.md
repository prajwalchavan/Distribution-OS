# Lane "retailer" — the shopkeeper's home as a shop front

Branch `ux/home-retailer` (from `ux/kit-signin` 96a44c47), worktree `.claude/worktrees/ux-retailer`.
Commits: `cb81951f` (the shop front, the basket, the navigation), `6818a379` (fixes after looking at it),
`ca276a87` (order screen heading). Nothing under `backend/` changed. Nothing merged, nothing pushed.

Founder's requirement (docs/22 §8, 2026-09-28): "a shopping app feel, not some complex feel"; minimise the
understanding effort; no photos yet; English only.

## 1. What the home shows now, top to bottom (phone 390 × 844; desk 1280 is the same order)

1. **The distributor that is open, as one chip** — logo, name, "Change ▾". Tapping it opens a sheet
   "Your distributors": "You owe ₹91,494.00 across 3 distributors", then one card per distributor (what each is
   owed, its last bill, a van at the shop, Call / WhatsApp on the open one when the owner has set a phone,
   and "Buy from here" on the others). These are the cards the home used to open on (DOS-102, DOS-103),
   moved unchanged into `src/groups/retailer/lib/distributors.tsx`. With one distributor the chip is just the
   name (not a button). On the phone home the shell header leaves the name to the chip (see §10, item 5).
2. **"Search items"** — typing two letters replaces the shop front with "N items match" and the matching items
   as tiles; clearing the field brings the shop front back. Searched on the device over the whole listed price
   list (name, local name, product, brand, maker, barcode; every word must match).
3. **"Your last order"** — one card: "4 items, about ₹12,837 at today's prices" (the last PLACED order's items
   still listed, priced today by `pricing.quote`). Primary button "Order again" (or "Add last order" when the
   basket already has something in it). The card body opens that order.
4. **"Your items"** — the items of the shop's five most recent placed orders, most often bought first, as
   `<ProductTile>`s: brand initial on the brand's colour, name, "24 pc case · 750 ml", this shop's rate
   "₹22.97 a piece + GST", MRP, an offer in a few words ("6% off on 1 case"), and a big "+ Add". Six on a phone,
   ten on a desk. "See all items" beside the heading opens the full price list (the order screen).
5. **"Shop by brand"** — a sideways row of `<BrandTile>`s (brand, "31 items"), biggest range first; a brand
   opens `/retailer/brand/[id]`: that brand's items as tiles, with the same cart bar.
6. **"Offers"** — a sideways row of the offers running today, each in one sentence ("Buy 1 case and take 6% off
   those items · On Godavari"); a card or "See all offers" opens the Offers page.
7. **On the way** (only when a stop is open) — one slim card "On the way · expected {when}" / "At your shop
   now" with ›; it opens the order the van carries.
8. **Money, one line** — "You owe ₹35,843.00  [Pay now]"; "Nothing to pay" when nothing is owed. After the
   products, never above them.
9. **"More 3" (closed)** — the four figures the home used to open on (your shop, overdue, bills to pay, last
   bill), the last payment line, the last five orders with "See all orders", and "Call or message {name}".
   Its reads run only when it is opened.
10. **The cart bar** at the foot of the home, a brand page and search: "1 item · ₹1,544.00 · See order".
    While the basket has moved on and the new quote is on its way it reads "about ₹772.00"; before the engine
    has answered anything it is "—"; an empty basket draws no bar.

## 2. The basket (one thing, kept)

`src/groups/retailer/lib/cart.ts` (pure store, tested) + `shopping.ts` (hooks). Lines are `{id, variantId,
qtyPcs}`; how a quantity was entered (case / piece) is worked out when the order is placed from today's case
size (`toOrderLines`, same rule DOS-098 already applied to "Order again"). Kept in `@dos/ui/platform` storage
under `dos.retailer.cart.<userId>.<tenantId>` (one per login AND per distributor), writes trail 300 ms, an index
`dos.retailer.carts` lists every basket on the device. Measured in the browser: survives a reload; Sai's
basket is empty while Tarsun's keeps its item; placing SO-0882 removed the key; signing out removed every
basket key (only `dos.device`, `dos.lastRole`, `dos.lastTenantId` left). Items the distributor stops listing
are taken out once the complete price list is in, and the order screen says how many. `order.tsx` now runs on
the same hooks (`useShopping`, `usePiecesEntry`, `useCartQuote`, `useListRates`, `usePriceList`).

## 3. Every button and what it writes

| Button | Where | What it writes |
| --- | --- | --- |
| + Add, −, +, Pieces | every tile, order rows | nothing on the server; the device basket only |
| See order | cart bar | nothing (opens `/order`) |
| Order again / Add last order | last-order card | nothing; opens `/order?repeat=<new id>`, which reads `orders.lastPlaced` and adds its listed items to the basket |
| Place order | order screen (unchanged) | `orders.create` + `orders.submit` (as before); then the basket is emptied |
| Empty this order | order screen | device basket only |
| Change ▾ → Buy from here | chip sheet, Me | `auth.switchTenant` (a new token; no business row) |
| Call / WhatsApp | chip sheet (open card), More | opens `tel:` / `wa.me`; nothing written |
| Pay now | money line | nothing; opens `/pay` (unchanged; the amount is typed there) |
| Sign out | Me (with a confirm dialog), ⋯ / account menu | empties every basket on the device, then signs out |
| A brand, an offer, "See all …", the van card | home | navigation only |

No money amount is on the home; nothing is pre-filled there. The only new confirm is Sign out on Me (it
empties the basket, and says so). Adding to the basket takes no confirm and shows no toast: the tile turns into
the stepper in place and the bar changes, which is the record of what happened; the list does not move.

## 4. Taps for each core job, before → after (phone)

| Job | Before | After |
| --- | --- | --- |
| Repeat the last order | Order again → Place order (2) | Order again → Place order (2) — unchanged (UX-01 R3) |
| Add one case of a usual item and place | ⋯ → Place order → search/scroll 171 rows → + → Place order (4 + typing) | + on the tile → See order → Place order (3) |
| Leave and come back to a half-built order | basket lost | basket kept (screens, restarts), per distributor |
| See my orders | ⋯ → My orders (2) | Orders tab (1) |
| Pay | Pay now in the bottom bar (1) | Pay now on the money line (1, after a scroll) or Money tab → Pay everything (2) |
| Bills / payments / account book | ⋯ → My bills (2) | Money → Bills / Paid / History (2) |
| What each distributor is owed | on the home (0) | chip (1) |
| Buy from another distributor | Open {name} on the home card (1) | Change → Buy from here (2) |
| Track a van | a row on the home that did not open anything | the van card opens the order (1) |
| Shop by brand | not possible | brand tile (1) |

## 5. Navigation

Primary section = the phone tab bar: **Shop · Orders · Money · Me** (`/retailer`, `/retailer/orders`,
`/retailer/dues`, `/retailer/profile`). A MORE section keeps every other page a destination (desk rail; phone ⋯
sheet): Offers, Bills, Payments, Account book, Returns and help, Messages, Shop details, Phones and login. Me
(`app/retailer/profile.tsx`, new route) lists Shop details, Messages (unread count), Returns and help, Offers,
Phones and login, Change password, Sign out, and the distributor cards. A brand page and the basket light the
Shop tab, paying lights Money (`tabOf`). No route was deleted; `/order` left the navigation but stays one tap
from every shopping screen (cart bar, "See all items").

**Design-system sentence this replaces:** UX-00 §8.2 "Delivery and retailer have no tab bar: single stacks
opening on the next stop / the last bill." (repeated in docs/23 §6 as "13 screens, no tab bar", and quoted in
the comment of `frontend/libs/ui/src/web/shell.tsx`). Replaced for the retailer by the founder's decision of
2026-09-28. The docs themselves were not edited in this lane (the architect owns that edit).

## 6. Words replaced (old → new)

Navigation: tab bar (none) → Shop · Orders · Money · Me · "Home" → "Shop" · "Place order" (nav entry) → removed
from the nav, page title "Place an order" → "Your order" · "My orders" → "Orders" (tab) · "Money due" → "Money"
(tab) · "My bills" → "Bills" · "Receipts" → "Payments" · "Statement" → "Account book" · "Returns" → "Returns and
help" · "My shop" → "Shop details" · "My account" → "Phones and login" · section titles "SHOP / MONEY / YOU" →
(none) / "MORE" · Money page tabs "Money due · My bills · Receipts · Statement" (cut to "Money …" on 390 px) →
"Due · Bills · Paid · History" · under the distributor name in the header "retailer" → nothing · account menu
second line "retailer" → "Shop owner".

Home: page title "Home" → no header (the chip leads) · "YOUR DISTRIBUTORS" → "Your distributors" (sheet) ·
"You are looking at {name}" → "Buying here now" · "Open {name}" → "Buy from here" · "Call {name}" → "Call" ·
"Start a new order" → "See all items" · "YOUR LAST ORDERS" → "Last orders" (under More) + "See all orders" · "ON
THE WAY" panel → "On the way · expected {when}" / "At your shop now" · "The same items as your last order, at
today's prices." → "Your last order" + "{n} items, about ₹X at today's prices" · "Order again" kept, "Add last
order" when the basket has items · "Past its date" → "Overdue" · "Bills still open" → "Bills to pay" · new:
"Change", "Search items", "Your items", "Shop by brand", "Offers", "See all offers", "See order", "a piece +
GST", "Nothing to pay". Offer sentences: "Buy 1 cases" → "Buy 1 case"; "off every cases" → "off every case".
Every nav and home button label is ≤ 20 characters (pinned in `shop-front.guard.test.ts`).

## 7. Tests

Changed deliberately (each names the founder's decision of 2026-09-28 in its header):
- `libs/ui/src/dos-101-order-pieces.guard.test.ts` — the pieces pad moved from `order.tsx` to
  `lib/pieces.tsx`; the guard follows it (parsePieces, `setQty(... qtyPcs ...)`), still pins the order screen's
  stepper `onOpenPieces`, and now also pins that every `<ProductTile>` opens the same pad. Nothing weakened.
- `dos-app/.../dos-102-across-total.guard.test.ts` — the cards moved to `lib/distributors.tsx`; same assertions
  there (`acrossTotal(across)`, no `?? 0`), plus: the home prints no summary figure of its own.
- `dos-app/.../dos-102-summary-service.guard.test.ts` — also walks the group's own `src/` (test files excluded,
  they name the wrong spelling on purpose); pins that `distributors.tsx` reads `api.auth.memberships.summary()`
  and the home opens `<DistributorList>`.

New: `lib/cart.test.ts` (18: taps, merge, order lines, restart, per login and distributor, tap-before-read,
one read per basket, placing empties one basket, sign-out empties all incl. a pending write, pruning, snapshot
identity, the "about" rule, the 400 ms settle), `lib/catalog.test.ts` (search, brands, your items, tile offers),
`lib/shop-front.guard.test.ts` (tabs, nothing removed, ≤ 20 characters, home order, More, money after products,
two-tap reorder, shared basket, sign-out), kit `web/home-blocks.test.tsx` + 1 (CartBar "about").

Kit change (both renderers, one contract): `CartBarProps.approximate` → "about ₹…" (web `shop.tsx`, native
`shop.tsx`, `types.ts`, string `shop.about`).

## 8. Gates (run in the worktree)

`pnpm format` 0 · `pnpm format:check` 0 · `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test` 0 (ui 503, dos-app 663,
api-client 130, offline 110, admin-app 14) · web export of dos-app 0 (with a private Metro TMPDIR, `--clear` and
`EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth`; the bundle was grepped for `distributionos.in`: none).

## 9. Looked at

Walked in headless Chromium against the demo API :3700 as `ramesh.gupta` at 390 × 844 and 1280 × 800: home,
add (cart bar exact after the quote, "about" while it is on its way), search, chip sheet, switching Tarsun → Sai
(empty basket) → Tarsun (basket kept), Kalyan (van card "At your shop now", More open), brand page, order screen
from the bar, "Add last order" (4 items, "added to the items already in your basket"), empty, place (SO-0882),
Me, sign out (all basket keys gone), Money tabs, the ⋯ sheet. Fixed on the way: header links wrapping to their
own line, "Change ▾" splitting over two lines, the name printed twice on the phone home, the Money tabs cut
off, "Buy 1 cases", the bar showing "about" a spent basket's total. Final screenshots: `final-390-*.png`,
`final-1280-*.png` in this folder.

## 10. Could not do, and why

1. **"Your items" is N+1 reads.** `orders.list` carries no lines, so the home reads the list and up to five
   `orders.get`. Missing: `orders.list` with lines, or a retailer read of "items this shop buys" (e.g.
   `orders.recentItems({ limit })`). Not built: no backend change this round.
2. **The home's cold load is ~15 reads** (price list pages, rates, stock pages, schemes, 1–2 quotes, orders list
   + gets, lastPlaced, outstanding, stops, my shop, unread). A single shop-front read would suit docs/20; backend.
3. **No photos**: the catalogue has no image field (decided: photos later).
4. **Native not run.** Both renderers compile and the kit parity tests pass, but no Android/iOS build was made
   (8 GB rule). SecureStore warns above ~2 KB a value; the stored basket is compact (~45 bytes an item), so
   past ~45 items a phone may warn — NOT TESTED on a phone.
5. **Kit follow-ups, not done here:** the phone shell has no slot for the home to put its own control in the
   header, so on the phone home the header shows only "⋯" (the chip carries the name); the desk `<Sheet>` wraps
   a short title ("Your / distributors"); the stacked stepper's "2 cs = 48 pc · 403 cs available" line is large
   inside a two-across tile.
6. **Pay screen unchanged**: `pay.tsx` still shows the whole dues in the amount field until the shop types
   (DOS-154 behaviour). Not changed in this lane; it is the existing screen the money line opens.
7. **Incident, reported:** the first export reused a shared Metro transform cache whose `config.ts` had
   `https://api.distributionos.in` inlined (the brief's command sets neither `--clear` nor
   `EXPO_PUBLIC_AUTH_URL`). One sign-in attempt from that build made the browser send a CORS preflight
   (OPTIONS, no body) to `https://api.distributionos.in/auth/auth/login`; the POST with the credentials was
   blocked by the browser and never left. Rebuilt with a private TMPDIR, `--clear` and the auth URL; checked.
8. **Data created in dos_test_ux:** order SO-0882 (1 case Sunbake Glucose 55 g, ₹1,059, submitted) for
   `ramesh.gupta` at Tarsun; it is now that shop's "last order" on the Tarsun home. Nothing else was written
   apart from `auth.switchTenant` tokens.

## Repair (after blind check 1, `verify-1.md`)

Commit `3a8f053d` on `ux/home-retailer` (on top of `ca276a87`). Nothing under `backend/`. Nothing merged, nothing pushed.

| Finding | What changed |
| --- | --- |
| **B1** DOS-179 guard refuses `me.signOutTitle` / `me.signOutBody` ("this phone"); the builder's pass was a cache replay | Strings reworded with no device word: "Sign out?" / "Your basket is emptied. Orders you have placed stay with your distributor." (right on a counter PC too). Root cause of the false pass: turbo hashes only a package's own files, and the offline and kit guards read `dos-app/` and `admin-app/` sources — `frontend/turbo.json` now gives `@dos/offline#test` and `@dos/ui#test` those folders as inputs (checked: the offline test hash now covers `dos-app/src/groups/retailer/strings.ts`). Every gate below was run with `--force` as well. New guard: the dialog strings carry no device word. |
| **M1** 390 × 844: 0 complete tiles, 0 "+ Add" above the fold | Three changes. (1) Kit: `AppShellProps.header` (web + native, phone shell only) — what the phone header shows in place of the tenant switcher; on the phone HOME the layout puts the distributor chip there (`DistributorChip place="header"`, no border of its own so "Sai Distributors, Dombivli" is not cut), so the page no longer spends a row on it. The chip and its sheet are now one component in `lib/distributors.tsx`, used by the header (phone) and the page (desk). (2) "Your last order" is one row: words left, "Order again" beside them (`LastOrderCard`, kit primitives; the kit JobCard puts the button full width under the words on a phone) — 178 px → 87 px. (3) Gaps close up on a phone (16/24 px instead of 24/32). Measured on the committed build, empty basket, tab bar top 774: suresh (Kalyan, one distributor) first tile 432–711, ramesh at Tarsun 432–689, Kalyan 432–689, Sai 432–711: **2 complete tiles and 2 "+ Add" above the fold for each**; no horizontal scroll. 1280 × 800: 5 complete tiles with "+ Add" (Sai). Screens `r-01`, `r-05`, `r-07`, `r-12`, `r-20` (390), `r-09`, `r-21` (1280). A search typed at one distributor is cleared when another is opened from the header chip (checked: "campa" → switch to Kalyan → empty field, sheet closed). |
| m1 Pay screen pre-fills the whole dues | NOT changed: DOS-154 behaviour pinned by `dos-154-pay-amount.guard.test.ts`; left for the architect's ruling. |
| m2 ⋯ "Sign out" empties every basket with no confirm | `lib/leave-confirm.tsx` (`useLeaveConfirm`): the ⋯ sheet, the account menu and Me open the same "Sign out?" dialog; its confirm is the only caller of `leave()`. Checked at 390: ⋯ → Sign out → dialog; "Stay signed in" kept the basket; confirm → only `dos.device`, `dos.lastRole` left in storage (`r-02`). Me at 1280 shows the same dialog (`r-11`). |
| m3 Tiles show no stock before "+ Add"; "Only 0 cs available — rest short-supplied" | Kit: `ProductTileProps.stock` (web + native), printed above the + and above the stepper. The retailer tile says it in the order screen's words: "Out of stock", "Only 4 pc left", and once the basket holds more: "Only 4 pc left. You may get less." The tile no longer feeds the kit stepper's availability line. The retailer catalogue overrides the kit's `qty.onlyAvailable` with "Fewer in stock. You may get less." (order screen). Checked: Annapurna Basmati 1 kg "Out of stock" and Besan 1 kg "Only 4 pc left" before the add; Besan after the add (`r-04`); Campa Orange 500 ml on the order screen (`r-15`). |
| m4 No number between − and +; wrapping "1 cs = 48 pc · 19 cs available"; order screen "0 cs" for a 10-piece line | Tile: the line under − + is now just "1 cs = 12 pc", one line (`r-04`). NOT changed: the number between − and + on the tile (69 + 19 + 69 fills the tile) and the order screen's "0 cs" middle value — both are the shared kit `QtyStepper`, used by sales, delivery and manager; a kit follow-up. |
| m5 Words | "More 3" → "More" (count dropped). Money page "Past its date" → "Overdue". The Orders tab page "My orders" → "Orders" (and "under My orders" → "under Orders"). Pack line "24 pc case" → "Case of 24" (tiles and order screen). NOT changed: "cs"/"pc" inside the kit stepper. Checked on screen (`r-13`, `r-14`). |
| m6 Sheet title wraps, Close mid-width | Kit web `<Sheet>`: Close is `fullWidth={false}` (at a touch floor a button defaults to full width, which took half the title row). Measured: title one line at 390 and 1280, Close at x 315–374 (390) and 1205–1264 (1280) (`r-06`, `r-10`). |
| m7 17 requests on a cold home | Not changed (backend gap, as declared). |
| m8 UX-00 §8.2 / docs/23 §6 still say "no tab bar" | Not changed (the architect owns that edit). |
| m9 Process (CORS preflight to the production host in the first build) | Every export in this round used a private Metro TMPDIR, `--clear` and `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth`, and the bundle was grepped before it was served: 0 files mention the production host; only `127.0.0.1` hosts. |

Guards changed deliberately (each names the founder's decision of 2026-09-28 and the check): `shop-front.guard.test.ts` (the cards behind `DistributorChip`; new: chip in the phone header and one-row last order; sign-out asks first from the menu and Me; dialog words; tile stock words), `dos-102-across-total.guard.test.ts` and `dos-102-summary-service.guard.test.ts` (the home names the chip, the chip holds `<Sheet>` with `<DistributorList>` — same chain, one link longer). Kit tests added: `ProductTile stock` and `AppShell header` (phone shows it, no header keeps the switcher, desk ignores it).

Gates in the worktree (logs `scratchpad/retailer/rp-*.log`): `pnpm format` 0 · `pnpm format:check` 0 · `pnpm lint --force` 0 · `pnpm typecheck --force` 0 · `pnpm test --force` 0 (0 cached: ui 507, dos-app 666, offline 110, api-client 130, admin-app 14) · web export of the committed head 0.

Data written to `dos_test_ux` in this round: SO-0456 (ramesh.gupta at Sai, "Order again" → "Place order", two taps, ₹6,323.00, `retailer_app`, submitted). Nothing else apart from sign-ins and `auth.switchTenant` tokens. Android / iOS not built (8 GB rule).
