# Blind check 2 — lane "retailer" (shopkeeper home as a shop front), after the repair

Branch `ux/home-retailer`, worktree `.claude/worktrees/ux-retailer`, head `3a8f053d` (worktree clean before and after;
nothing edited, nothing committed by this check). Demo API `http://127.0.0.1:3700`, database `dos_test_ux` (read-only
SQL). Web export served on :5730, headless Chromium on :9730 (both started by this check and stopped before
reporting). Date 2026-09-28, 11:48–12:15. Screenshots of this check are `c2-*` in this folder (`v1-*`/`v2-*` are
check 1, `r-*` and `final-*` are the builder's).

**Verdict: PASS** — both earlier problems are fixed (B1 gate, M1 first screen); every gate is green without the turbo
cache; the twelve checks pass. No blocker, no major. Nine minors, two of them new (a stale cross-distributor quote
request after switching; the neighbour's "+ Add" drops behind the cart bar after the first add).

---

## 0. The earlier problems first

| Check 1 finding | Now | Evidence |
| --- | --- | --- |
| **B1** DOS-179 guard failed without the cache ("Sign out on this phone?") | FIXED. `pnpm test --force`: offline 110/110, 0 cached. Dialog reads "Sign out? Your basket is emptied. Orders you have placed stay with your distributor." at 390 (⋯ sheet, Me) and 1280 (account menu). Root cause fixed too: `turbo run test --dry=json` now lists `../../dos-app/src/groups/retailer/strings.ts` among the inputs of `@dos/offline#test` (445 files) and `@dos/ui#test` (534 files). The override replaces an empty `test: {}`, so nothing (dependsOn, env) is lost. | `c2-19`, `c2-30` |
| **M1** 390 × 844: 0 whole tiles, 0 "+ Add" above the fold | FIXED. 2 whole ProductTiles with their "+ Add" for every login and distributor tried (table in §2.1). | `c2-01`, `c2-21`, `c2-24`, `c2-26` |
| m2 ⋯ Sign out emptied baskets with no confirm | FIXED. ⋯ sheet, account menu and Me all open the same dialog; "Stay signed in" keeps the basket (key still in storage, bar "1 item ₹384.00"); confirm leaves only `dos.device`, `dos.lastRole` (+ `dos.lastTenantId`). | `c2-18`, `c2-19`, `c2-20`, `c2-30` |
| m3 no stock on tiles before "+ Add" | FIXED. "Only 4 pc left" on Annapurna Besan 1 kg before any add; order screen "Fewer in stock. You may get less." replaces the godown sentence. | `c2-01` text |
| m4 no number between − and +; "0 cs" for a 10-piece line | PARTLY (declared). Tile line is one line ("1 cs = 48 pc"), still no number between − and +; order screen still "− 0 cs +" for 10 pc. Kit follow-up. | `c2-02`, `c2-16`, `c2-17` |
| m5 words | FIXED. "More" without count, Money page "OVERDUE", Orders tab page "Orders", "Case of 48". "cs"/"pc" remain in the kit stepper (declared). | `c2-36` |
| m6 sheet title wraps / Close mid-width | FIXED. Title one line; Close at x 1205–1264 (1280) and at the right edge at 390. | `c2-23`, `c2-29` |
| m1 Pay pre-fills the whole dues | NOT CHANGED (declared): `pay.tsx` and `dos-154-pay-amount.guard.test.ts` identical to base `46b13020`. Field value `26470.00` before typing. Architect to rule. | `c2-27` |
| m7 N+1 reads / m8 docs say no tab bar | NOT CHANGED (declared backend gap / architect's doc edit). | — |

---

## 1. Gates (run by this check in the worktree, `frontend/`)

| Gate | Command | Result |
| --- | --- | --- |
| format | `pnpm format:check` | 0 — "All matched files use Prettier code style!" |
| lint | `pnpm lint --force --concurrency=2` | 0 — 6/6 tasks, 0 cached |
| typecheck | `pnpm typecheck --force --concurrency=2` | 0 — 6/6 tasks, 0 cached |
| test | `pnpm test --force --concurrency=1 --continue` | 0 — 5/5 tasks, 0 cached: dos-app 129 files / 666 tests, ui 37 / 507, offline 11 / 110, api-client 13 / 130, admin-app 4 / 14 |
| web export | `node ./scripts/sync-fonts.mjs && TMPDIR=<private> EXPO_PUBLIC_API_URL=http://127.0.0.1:3700 EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth pnpm exec expo export --platform web --clear --output-dir scratchpad/retailer-web` | 0. Bundle grepped before serving: 0 files mention `distributionos`; hosts found: `127.0.0.1:3700`, `127.0.0.1:3700/auth`, `127.0.0.1:3001` (the per-port default) |

Logs: `scratchpad/retailer/c2-format.log`, `c2-lint.log`, `c2-typecheck.log`, `c2-test.log`, `c2-export.log`.
The auth URL was set explicitly (the brief's command omits it; without it the build signs in against :3000).

Named guards run on their own: `libs/ui` dos-101, dos-105, dos-124, dos-144, dos-154 — 5 files, 22 tests passed;
`dos-app` dos-102 ×3 — 3 files, 10 tests passed. The repair's guard edits (`dos-102-across-total`,
`dos-102-summary-service`) swap `<DistributorList` on the home for `<DistributorChip` plus a new assertion that the
chip holds `<Sheet>` then `<DistributorList>` — the chain is pinned one link longer, nothing dropped.

---

## 2. The twelve checks

Logins: `suresh.chauhan` (one distributor, Kalyan Agencies, past orders), `ramesh.gupta` (Tarsun, Kalyan, Sai),
`fatima.shaikh` (Tarsun; old last order, for re-pricing).

### (1) First screen at 390 × 844 — PASS

Rectangles measured in the page after it settled (`scratchpad/retailer/measure.js`), empty basket, tab bar top 774:

| Login / distributor | Header | Search | Last order | Row 1 tiles (whole) | Row 1 "+ Add" | Row 2 peek | Brand tiles | Money line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| suresh / Kalyan | 0–86 (chip) | 130–199 | 223–310 | 432–711 ×2 | 642–711 ×2 | 735– (39 px) | 1412 | 1804 |
| ramesh / Tarsun | 0–86 (chip + Change ▾) | 130–199 | 223–310 | 432–689 ×2 | 620–689 ×2 | 713– (61 px) | 1378 | 1772 |
| ramesh / Kalyan | same | same | same | 2 whole | 2 visible | yes | below | below |
| ramesh / Sai | 0–86 | 130–199 | 223–310 | 432–711 ×2 | 642–711 ×2 | 735– | 1400 | 1794 |

So: **2 whole ProductTiles and 2 "+ Add" above the fold, 0 BrandTiles** (the brand row starts ~1400 px). Above
them, top to bottom: the distributor chip in the header ("KA Kalyan Agencies" / "Tarsun Enterprise Change ▾", "⋯"),
the "Updated just now" line, "Search items", "Your last order · N items, about ₹X at today's prices [Order again]",
the "Your items / See all items" heading. Money is not first (it is ~1770–1800 px down). No horizontal scroll
(scrollWidth 390). With a kept basket the cart bar (680–774) still leaves 60 of the 69 px of each "+ Add" visible
and the middle of the button tappable (`c2-35`).

1280 × 800 (ramesh / Sai): 5 whole tiles with "+ Add" (482–761), second row at 785 (`c2-28`).

### (2) A fresh order of three items from the home — PASS

suresh, empty basket. Taps: "+ Add" (Campa Lemon 200 ml), "+ Add" (Balaji Simply Salted Wafers 45 g), scroll,
"+ Add" (Balaji Ratlami Sev 200 g), "See order", "Place order" = **5 taps**, no confirm (the order screen had none
before). Cart bar "3 items ₹3,322.00"; order screen Before offers ₹2,763.96, GST ₹557.80, Rounding ₹0.24, You pay
₹3,322.00; landed on SO-0190 with "Order SO-0190 is with Kalyan Agencies." (`c2-02` … `c2-05`).

```sql
select o.order_no, t.slug, o.state, o.source, o.subtotal_paise, o.tax_paise, o.cess_paise, o.round_off_paise, o.total_paise, u.username
  from sales_orders o join tenants t on t.id=o.tenant_id join users u on u.id=o.created_by
 where o.id='01a0e6af-945a-75b9-90f4-4fcb4140dd07';
-- SO-0190 | kalyan-agencies | submitted | retailer_app | 276396 | 55780 | 3289 | 24 | 332200 | suresh.chauhan
select l.line_no, pv.name, l.entered_qty, l.entered_unit, l.pack_size_at_entry, l.qty_pcs, l.rate_paise, l.line_total_paise ...
-- 1 | Campa Lemon 200 ml               | 1 | case | 48 | 48 |  571 |  38371
-- 2 | Balaji Simply Salted Wafers 45 g | 1 | case | 48 | 48 | 1471 |  83317
-- 3 | Balaji Ratlami Sev 200 g         | 1 | case | 30 | 30 | 5946 | 210488
```

Rates equal the tiles (₹5.71, ₹14.71, ₹59.46 a piece), pieces 48/48/30, line totals equal the screen (₹383.71,
₹833.17, ₹2,104.88); total 332200 paise = the cart bar's ₹3,322.00 to the paisa.

List did not jump: with a real mouse click (not Playwright's scroll-into-view) at scrollTop 626, "+ Add" on Balaji
Ratlami Sev → scrollTop 626, tile turned into the stepper in place (`c2-03`). No toast for an add (nothing is
written); the toast comes on Place order.

### (3) "Order again" — PASS

suresh: "Order again" (tap 1) → `/order?repeat=01a0e6b0-…` with the three lines → "Place order" (tap 2) = SO-0191,
three lines identical to SO-0190, 332200. The create request carried no rate:
`{"retailerId":"7ffaa95a…","source":"retailer_app","lines":[{"variantId":"b2794ad9…","enteredQty":1,"enteredUnit":"case"},…]}`
then `/orders/<id>/submit` (`c2-07`, `c2-08`).

Re-pricing at today's rate: fatima at Tarsun, last order SO-0875 of 12 Sep = 10153100 paise with 561905 of scheme
discounts; home card "10 items, about ₹1,07,984 at today's prices"; order screen "Offers ₹0.00 … You pay
₹1,07,984.00" (`c2-32`) — priced today, not copied. Not placed; "Empty this order" emptied it.

### (4) The basket survives — PASS

suresh: "+ Add" Campa Cola 750 ml and Campa Cola 1 L on the home → "2 items ₹1,738.00"; Balaji brand page → bar the
same; "+ Add" Balaji Chataka Pataka Wafers → "3 items ₹2,575.00"; Orders tab (no bar, `c2-10`) → Shop → "3 items
₹2,575.00"; page reload → "3 items ₹2,575.00" (`c2-11`), stored as
`dos.retailer.cart.<user>.<tenant>` = `{"v":1,"l":[[f71bf137…,24],[f086f3e3…,24],[1e08c003…,48]]}`. See order →
"You pay ₹2,575.00" → Place order = SO-0192 (257500; Campa Cola 750 ml 1 case 24 pc @2309, Campa Cola 1 L 1 case
24 pc @2864, Chataka Pataka 1 case 48 pc @1478). Back home: no bar, no cart key and no index key in storage.

### (5) One basket per distributor — PASS (one minor, see M-a)

ramesh at Tarsun: + Campa Cola 750 ml, + Sunbake Glucose 55 g → "2 items ₹1,831.00". Header chip "Change ▾" →
sheet → Kalyan "Buy from here": no bar; Campa Cola 750 ml (same global variant) shows "+ Add", Sunbake is not on
Kalyan's home; + Campa Cola at Kalyan → "1 item ₹772.00", a second storage key. Back to Tarsun → "2 items
₹1,831.00" → Place order = SO-0908:

```sql
-- SO-0908 | tarsun | retailer 34191c43… (Shree Ganesh Kirana @ tarsun) | submitted | retailer_app | 183100 | ramesh.gupta
-- 1 | Campa Cola 750 ml    | 1 | case | 24  | 2297 | 77179  | line tenant = order tenant
-- 2 | Sunbake Glucose 55 g | 1 | case | 120 |  748 | 105917 | line tenant = order tenant
```

Only the Tarsun basket's items, under Tarsun; the Kalyan key kept its Campa Cola. Then (at Sai, Kalyan basket still
stored) account menu → Sign out → dialog → confirm: storage left `dos.device`, `dos.lastRole`, `dos.lastTenantId`.

**M-a (minor, new):** right after a switch the home sends one `pricing.quote` with the NEW distributor's
retailerId and the PREVIOUS distributor's basket lines. Logged twice on Tarsun → Kalyan:
`REQ /retailer/pricing/quote retailerId a22500e8 (Kalyan shop) lines f71bf137 ×24, af45e021 ×120` →
`400 "No price for variant af45e021… "`, then the right quote. Cause: `useCartQuote` keeps its `settled` state
across the switch (the home stays mounted) and the settler replaces it only 400 ms later
(`src/groups/retailer/lib/shopping.ts` lines 232–252). Nothing is written (`quote.service.ts`: "it never writes"),
nothing wrong was seen on screen, and no order can cross; but one distributor's basket is priced under another's
shop and a 400 lands in the console on every switch where an item is not listed at the other.

### (6) Search — PASS

Kalyan, "masti" → "1 item matches" (Balaji Masala Masti Wafers 45 g); "+ Add" in the result → "1 item ₹830.00";
"dal" → "4 items match"; "zzzq" → "0 items match / Nothing matches "zzzq""; clearing brings the shop front back
(`c2-13`, `c2-14`).

### (7) Brand page — PASS

Kalyan "Balaji · 4 items" → `/retailer/brand/ebfe6f6d…`: 4 tiles, all Balaji (`c2-09`). Tarsun "Godavari · 23
items" → `/retailer/brand/779361b4…`: 23 tiles, every name starts "Godavari" (`c2-34`).

### (8) Pieces — PASS

Search tile → "Pieces" → pad "How many pieces" (`r2-pieces-input`, inputmode decimal, holds 48 after the add) →
10 → "Set pieces": tile "10 pc", bar "1 item ₹173.00" (`c2-15`, `c2-16`); order screen "₹14.66 per piece + GST ·
10 pc ₹172.99 − 0 cs +" (`c2-17`); Place order = SO-0193: `10 | piece | pack 1 | 10 pc | 1466 | 17299 | total
17300`. From the home a shop reaches pieces under a case by "+ Add" then "Pieces" (as in check 1); every row of the
order screen's price list has "Pieces" directly. Guards: see §1.

### (9) Pay now — PASS (m1 stands)

ramesh at Sai: money line "You owe ₹26,470.00 [Pay now]" → `/retailer/pay`, seven bills, bottom "₹26,470.00". SQL
(`invoices` minus `allocations`, not cancelled/paid, ramesh's Sai shop): SAI/0081 1,161.00 + 0254 4,287.00 + 0280
3,847.00 + 0363 4,579.00 + 0382 1,845.00 + 0394 4,541.00 + 0419 6,210.00 = ₹26,470.00. The amount field's value is
`26470.00` before typing (DOS-154; unchanged file) (`c2-27`).

### (10) Nothing of the old home is gone — PASS

Re-checked against check 1's table (still true at `3a8f053d`): the repair's diff of `index.tsx` removes only the
page-level `Sheet` and the local `DistributorChip` (moved into `lib/distributors.tsx`, opened from the phone header
and from the desk page) and the `JobCard` (replaced by the one-row `LastOrderCard`, same button, same body link).

| Old home element | Now (seen in this check) |
| --- | --- |
| "You owe ₹X · Pay now" | Money line after the products (`r2-pay`) + Money tab |
| "Order again" + its sentence | "Your last order" card, "Order again" / "Add last order"; body opens the order (SO-0875 opened) |
| "Your distributors" cards (owed, last bill, van, Call/WhatsApp, Open) | Header chip → sheet "You owe ₹91,494.00 across 3 distributors", one card each, "Buy from here" (`c2-23`, `c2-29`); Me page |
| Four figures, last payment | More: YOUR SHOP, OVERDUE, BILLS TO PAY, LAST BILL, "Last payment: ₹45,511.00 · 12 Sep, 4:30 pm" (`c2-33`) |
| Recent orders | More: "Last orders" (5) + "See all orders" |
| Next delivery | "On the way / At your shop now" card when a stop is open (checked in check 1) |
| Other pages | Tabs Shop · Orders · Money · Me; ⋯ sheet: Offers, Bills, Payments, Account book, Returns and help, Messages, Shop details, Phones and login, Change your password, Sign out (`c2-18`) |

### (11) Backend and routes — PASS

`git diff --name-only 46b13020 3a8f053d -- backend` → 0 files. `git diff --name-status 46b13020 3a8f053d`: 22 A,
35 M, 0 D, 0 R; no file under `frontend/dos-app/app` missing at head (`comm` of the two trees → 0). Route changes:
`A app/retailer/brand/[id].tsx`, `A app/retailer/profile.tsx`, `M` index, order, _layout, sign-in, change-password.

### (12) No credit limit, no cost — PASS

fatima (Tarsun): 14 pages + a brand page visited (home, order, orders, dues, bills, receipts, statement, deals,
returns, inbox, shop, settings, profile, pay) with every JSON body from :3700 walked for keys matching
`credit_?limit|creditAvailable|available_?credit|cost|margin|landed|purchase_?price`: 104 responses, 28 endpoints,
**0 hits**. Page text: only the pre-existing sentence on Shop details ("Your terms, tier and credit limit are set by
Tarsun Enterprise and cannot be changed here."), no figure.

### Rule 8 (web and native)

Repair's kit changes: `AppShellProps.header` and `ProductTileProps.stock` in `types.ts`, implemented in both
`web/shell.tsx` + `native/shell.tsx` and `web/shop.tsx` + `native/shop.tsx`; the web `Sheet` Close change has no
native counterpart to change (native Sheet puts Close as the last row of the content). ui tests 507/507 incl. parity.
Native NOT RUN (8 GB rule).

---

## 3. Would a first-time shopkeeper know what to do in five seconds?

Phone: yes. The first screen reads like a shop: the distributor's name at the top, "Search items", "Your last
order … Order again", then two of the shop's own items with price, MRP and a large "+ Add". Nothing about money or
figures competes with it. What helps: one primary colour for the three things to press; plain words ("a piece +
GST", "Case of 48", "Only 4 pc left"). What gets in the way: after the first "+ Add" the tile shows "−" and "+"
with nothing between them and a bold "1 cs = 48 pc" underneath, plus a big "Pieces" button — the quantity is there
but in a code; and the tile next to it loses its "+ Add" behind the cart bar, so adding the second visible item
needs a scroll. Letter blocks ("C", "B") read as missing pictures (decided: photos later). Desk: yes — five items
with "+ Add" on the first screen; the distributor's name shows twice (rail, truncated "Sai Distributor…", and the
page chip).

---

## 4. Findings

**Blocker** — none.

**Major** — none.

**Minor**
- M-a (new) After a distributor switch one `pricing.quote` is sent with the new shop's retailerId and the previous
  distributor's basket (`useCartQuote` keeps `settled` across the switch); read-only, 400 in the console when an
  item is not listed there (§2.5).
- M-b (new) After the first "+ Add" on the phone home the tile grows (stepper, "1 cs = 24 pc", Pieces) and the
  neighbour's "+ Add" moves from 620–689 to 738–807, fully behind the cart bar (680–774); the second visible item
  needs a scroll (`c2-22`).
- m1 Pay screen opens with the whole dues in the amount field (DOS-154, unchanged; architect to rule against
  "money never pre-filled").
- m4 Tile stepper: no number between − and +; order screen "0 cs" middle value for a 10-piece line; "cs"/"pc"
  (declared kit follow-up).
- "Empty this order" empties a basket built across screens with no confirm (the button pre-exists; the basket now
  persists), while Sign out asks first.
- Sign-out dialog says "Your basket is emptied" when the open distributor's basket is empty and another's is not
  (all are emptied).
- Desk: distributor name twice (rail switcher truncated + page chip).
- `app.onlineOnly` ("Nothing is kept on this phone") is unused but now untrue for the kept basket; delete or reword
  if it is ever shown.
- m7 home cold load is N+1 (`orders.list` has no lines) and m8 UX-00 §8.2 / docs/23 §6 still say "no tab bar"
  (both declared).

**Not tested**
- Android / iOS: not built or run (8 GB rule). SecureStore size past ~45 basket items not tried.
- The "about ₹…" cart-bar state while a quote is in flight was not caught on screen.
- The "On the way" card was not re-checked in this round (no open stop created; check 1 saw it on SO-0171).

---

## 5. Data written to dos_test_ux by this check

```sql
select o.order_no, t.slug, u.username, o.state, o.total_paise from sales_orders o join tenants t on t.id=o.tenant_id
  join users u on u.id=o.created_by where u.username in ('suresh.chauhan','ramesh.gupta','fatima.shaikh')
  and o.created_at > '2026-09-28 11:48+05:30' order by o.created_at;
-- SO-0190 | kalyan-agencies | suresh.chauhan | submitted | 332200
-- SO-0191 | kalyan-agencies | suresh.chauhan | submitted | 332200
-- SO-0192 | kalyan-agencies | suresh.chauhan | submitted | 257500
-- SO-0193 | kalyan-agencies | suresh.chauhan | submitted |  17300
-- SO-0908 | tarsun          | ramesh.gupta   | submitted | 183100
```

Nothing else apart from sign-ins and `auth.switchTenant` tokens. Every basket was emptied (placed or signed out).

## 6. Screenshots (this folder)

`c2-00` sign-in 390 · `c2-01` suresh home 390 · `c2-02` two added · `c2-03` third added while scrolled · `c2-04`
order screen · `c2-05` SO-0190 placed · `c2-06` home after · `c2-07`/`c2-08` order again → SO-0191 · `c2-09` Balaji
brand page · `c2-10` Orders tab · `c2-11` after reload · `c2-12` SO-0192 · `c2-13`/`c2-14` search · `c2-15`/`c2-16`
pieces pad and 10 pc · `c2-17` order screen "0 cs" · `c2-18` ⋯ sheet · `c2-19` menu sign-out dialog 390 · `c2-20` Me
· `c2-21` ramesh Tarsun home 390 · `c2-22` after first add (neighbour's Add behind the bar) · `c2-23` chip sheet 390
· `c2-24` ramesh Kalyan home · `c2-25` Kalyan basket · `c2-26` Sai home · `c2-27` pay · `c2-28` Sai home 1280 ·
`c2-29` chip sheet 1280 · `c2-30` account-menu sign-out dialog 1280 · `c2-31` sign-in 1280 · `c2-32` fatima order
again · `c2-33` fatima home with More open · `c2-34` Godavari brand page · `c2-35` home with a kept basket · `c2-36`
Money tab.

Processes started by this check (static server :5730, browser :9730) were stopped before reporting.
