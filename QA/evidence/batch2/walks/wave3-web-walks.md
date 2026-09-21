# wave3-web-walks — the browser half of seven merged lanes

Walked 2026-09-21 in the worktree `.claude/worktrees/b2-walks`, branch `main` at **50cab0c** (clean tree),
against database **`dos_test_b2_walks`**. Web only, at **1280×800** and **390×844**. No Android and no iOS —
see "Machine reading". Every fix named below was walked, not read.

## What I started, and what I stopped

| Thing | Where | Stopped |
| --- | --- | --- |
| `backend/all-in-one` (`DOS_MODE=all WORKER_INLINE=1 ALL_IN_ONE_PORT=3100`) | **:3100**, eight services behind prefixes + inline worker | yes |
| `@dos/retailer-app` expo web | **:5178** | yes |
| `@dos/warehouse-app` expo web | **:5176** | yes |
| `@dos/owner-app` expo web | **:5173** | yes |
| `@dos/manager-app` expo web | **:5174** | yes |
| `@dos/sales-app` expo web | **:5175** | yes |
| `QA/tools/pw-server.mjs` (headless Chromium, CDP) | **:9350** | yes |

Ports **:3000–:3007 were already held** by processes I did not start (PIDs 99690–99708) and were never
touched. Another block's pw-server and a Metro on :5276 were left alone. Every app was started with
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3100`, `EXPO_PUBLIC_API_PREFIX=/<role>` **and
`EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3100/auth`** — the last one matters (see the previous block's setup
hazard); every token I measured carried `tid 01a0999a-…`, the pilot Tarsun tenant in THIS database.
`dos` and `dos_qa` were never connected to. The database was **not re-seeded**: it arrived seeded
(3 tenants, 1 544 orders, 1 501 bills) and the walks below needed live data, not fresh data.

**Machine reading before any device work** (this block's refusal rule): free RAM **13 826 pages × 16 KiB =
226 MB** and swap **7 849.75 / 9 216 MB = 85.2 %** at the start, falling to **3 731 pages = 60 MB** free while
a Metro ran. Both past the ~300 MB / ~85 % thresholds, so **no emulator and no simulator was booted**. The
device legs are returned not-proven with that reading, not guessed at.

**Test data I created or spent, in a database named "test"** — recorded so the next block is not surprised:
PICK-0080 (a two-order wave, SO-0870 + SO-0873, started, 4 pc picked then put back); one single-order wave
cancelled through the hook; SO-0877, SO-0867, SO-0868 and SO-0873 cancelled; SO-0868's and SO-0867's
approvals decided; one `outstanding` CSV export queued; **SO-0879 placed through the sales app in the
browser** (the DOS-079 evidence). Nothing on `dos` or `dos_qa`.

---

## 1. The one that deserved special attention — does a credit figure reach the shop's own device?

**Verdict on the question as asked: PROVEN. No credit figure reaches the retailer app.**

Signed in as `ramesh.gupta` (Shree Ganesh Kirana) and captured every API response of a full session
(`wave3-web-walks-net-retailer.json`, 9 responses, all 200):

| Call | What it carried |
| --- | --- |
| `GET /retailer/retailers?limit=5&activeOnly=true` | 510 bytes, 16 fields — `id,name,ownerName,phone,altPhone,address,lat,lng,beatId,gstRegType,gstin,stateCode,paymentTerms,cashDiscountBps,cashDiscountDays,active`. **No `creditLimitPaise`, no `creditMode`, no `creditDays`, no `tier`, no `code`.** |
| `GET /retailer/receivables/outstanding/34191c43-…` | `outstandingPaise 3584300`, `overduePaise 3584300`, ageing buckets — **intended**: docs/22 DOS-100 says the shop's screen shows the overdue amount with a Pay button. |
| the other 7 (login, branding, orders, invoices, messages, memberships, stops) | no credit-shaped key |

Regex `credit_limit|creditLimit|credit_days|credit_mode|headroom` over **all nine bodies: 0 matches.**
The home screen reads "You owe ₹35,843.00" and never a limit.
Screenshot `wave3-web-walks-webdesk-retailer-home.png`.

**The lane's own fix re-measured and holding.** `sales_orders` through `sync.pull`:

| Role | `sales_orders` columns in the manifest | `credit_notice` | `stock_shortages` |
| --- | --- | --- | --- |
| retailer (`ramesh.gupta`) | **28** | **absent** | **absent** |
| salesperson (`rahul.deshmukh`) | **30** | present | present |

A 200-row sweep of every pulled row of all 18 retailer tables found **no** credit-shaped key.

**But the door next to it is still open — filed as S-177.** `GET /retailer/sync/pull?tables[]=retailers`
as the shopkeeper returns his own row carrying `credit_limit_paise: 5000000`, `credit_limit_bills: 0`,
`credit_days: 7`, `credit_mode: "strict"`. docs/22 §8 (DOS-100) says the shop is shown "never a credit limit
or credit-available figure". Nothing is on a shop's device today — `frontend/retailer-app` contains **zero**
`@dos/offline` files and made **no** `sync.*` call in the whole session — so it is an open door, not a live
leak. The fix is the same `omit` shape as `orders.module.ts:56-64`, on the `retailers` pull.

For contrast, measured in the same run: the REP's shop card correctly shows "Credit limit ₹50,000.00 ·
Credit days 7 · Headroom ₹14,157.00 · Strict". The boundary is exactly where docs/22 puts it.

---

## 2. DOS-122 — dialog geometry at 390 and 1280, including the consequence nobody had seen

The kit-polish review asked for four measurements and named the fourth as the designed consequence of keying
on `theme.touch`. All four taken, from `getBoundingClientRect` and `getComputedStyle`, not by eye.

| App (touch) | Viewport | `flex-direction` | button w × h | top → bottom | DOM order | focus |
| --- | --- | --- | --- | --- | --- | --- |
| warehouse (`floor`) | **1280×800** | **column-reverse** | 440 × **76 px** | Send the vehicle out @y=369, Cancel @y=457 | Cancel first | **confirm** |
| warehouse (`floor`) | **390×844** | column-reverse | 318 × **76 px** | confirm above Cancel | Cancel first | — |
| owner (`desk`) | **1280×800** | **row** | 78 / 88 × **32 px** | both @y=437 | Cancel first | **confirm** |
| owner (`desk`) | **390×844** | **column-reverse** | 318 × **63 px** | Approve @y=423, Cancel @y=498 | Cancel first | — |

Every prediction in the review holds, including the one it flagged as unseen: **a floor app on a DESK
viewport gets the stacked, full-width 76 px pair.** In all four cases Cancel keeps its original DOM and tab
position while rendering below the confirm, and focus lands on the confirm. Full width is real, not
inherited: 440 px inside a 480 px dialog (padding 20), 318 px inside 358.

Dialogs measured: warehouse "Check out MH-05-AB-1234?" (`w7-dialog`, the exact one the review named) and
owner "Approve Mahalaxmi General Stores". Screenshots `wave3-web-walks-{webdesk,webphone}-kit122-{warehouse-checkout,owner-approve}.png`.

**Judgement asked for by the review — is the desk-viewport warehouse dialog wrong?** No. On a 1280 px
warehouse screen the 76 px pair is the same height as every other control in that app, it is the only dialog
on screen, and the confirm sits above Cancel exactly as the native dialog does. Record it as designed.

---

## 3. lean-manager-money — DOS-035, DOS-036, DOS-038, DOS-141

**DOS-035 (overdue as money) — PASS.** Manager → Shops → Patil General Store panel: `Owes ₹ **₹69,604.50**`
and `**₹69,604.50 overdue**`. Formatted rupees with the paisa, not a raw integer.
`wave3-web-walks-webdesk-dos035-shop-panel.png`.

**DOS-036 (statement) — PASS, and it reconciles.** Three heads `Debit ₹ / Credit ₹ / Balance ₹`; the FIRST
row is `Opening balance · 23 Jun 2026 · — · — · 17,197.00`, dated the 90-day window's `from` (21 Sep − 90 d);
the LAST balance is **69,604.50**, equal to the panel's "Owes ₹69,604.50" to the paisa. At 390×844
`document.documentElement.scrollWidth = 390 = innerWidth` — **no horizontal scroll**.
One wording snag filed as **S-181**: a second row 24 lines later is also labelled "Opening balance"
(`OPEN/0001 · 1 Aug 2026 · 12,376.50`), so the statement reads as if it opens twice.

**DOS-038 (phone rows read "name · policy") — PASS.** At 390×844 the eight visible rows read
`Khan General Store · Blocked`, `Ambika Provision Store · Needs approval`, `Sai Baba Kirana · Warn only`,
`Shubhalabh Stores · Needs approval`, `Joshi Kirana Stores · Warn only`, `Patil General Store · Blocked`,
`Balaji Wholesale Stores · Warn only`, `Vitthal Traders · Needs approval` — identity + policy chip, and the
credit LIMIT (which the desk table does show) is dropped. No overflow. `wave3-web-walks-webphone-dos038-shops-rows.png`.

**DOS-141 (a bounce needs a reason) — PASS, measured at the wire.** Money → RCPT-CHQ-0001 (Dnyandeep Stores,
Cheque ₹29,952.00) → Mark bounced → confirm with the reason EMPTY. Result: the field error
"**Write what the bank said**" renders under "What did the bank say?", and the POST counter went
**1 → 1: no request was made**. The field error, not a silent disabled button — the better product, as the
review said. `wave3-web-walks-webdesk-dos141-bounce-empty-reason.png`.

**Allocation reads a document number, not a uuid (owner-money-approvals' manager half) — PASS.**
RCPT-0696 (Balaji Wholesale Stores, bank transfer ₹45,511.00) panel: `Put against **INV/0366** · Paid
₹45,511.00`. Regex for uuid fragments over the whole panel: **0 matches**. (The review's example said
"OPEN/0005 — ₹9,182.00"; this database's RCPT-0696 settles INV/0366. The claim — a document number rather
than a uuid — is what was proven.) `wave3-web-walks-webdesk-rcpt0696-allocation.png`.

---

## 4. lean-owner-money-approvals — the merge blocker, and the money identity

**Blocker 1 (DOS-014: the export dialog must not promise a period it does not send) — PASS, on screen AND
on the wire.** Owner → Reports → Exports → Request export, reading `exports-request-summary` and counting
`exports-period` nodes per register:

| Register | period control | summary line |
| --- | --- | --- |
| Daily sales | 1 (`7 days 30 days 90 days`) | `Daily sales · CSV · 23 Aug 2026 to 21 Sep 2026` |
| Orders | 1 | `Orders · CSV · 23 Aug 2026 to 21 Sep 2026` |
| **Stock value** | **0** | `Stock value · CSV · **whole register**` |
| **Money owed** (`outstanding`) | **0** | `Money owed · CSV · **whole register**` |
| Money collected | 1 | dated |
| GST sales register | 1 | dated |
| Fill rate | 1 | dated |

Then I queued the "Money owed" export and read the request the browser actually sent:
`POST /owner/reporting/exports` body
`{"id":"01a0c260-…","idempotencyKey":"01a0c260-…","register":"outstanding","format":"csv","filters":{}}`
— **`filters: {}`**, no `from`, no `to`. Screen and wire agree; the class of defect the finding names
("says exactly what is queued") is closed for the two registers it was broken on.
`wave3-web-walks-webdesk-dos014-exports-{money-owed,stock-value}.png`.

**DOS-016 (headline gross, on-account beside it) — PASS, and the identity holds to the paisa.**
Owner → Today: `**₹38,23,697.00 overdue · less ₹35,080.00 on account**`.
Owner → Money: `**On account ₹35,080.00 · Net dues ₹43,89,199.00** (matches Books → Trial balance)`.
I did not take the screen's word for the parenthesis. The API gives `totalOutstandingPaise 442427900`,
`onAccountPaise 3508000`, difference **438 919 900**. The journal gives
`select sum(amount_paise) … where account = AR 'Sundry Debtors (retailers)'` = **438 919 900**.
Equal to the paisa. `wave3-web-walks-webdesk-dos016-{today,money}.png`.

**DOS-013 (a variant name, never an id fragment) — PASS.** Owner → Prices → Default Price List, the row
after `Konkan Farsan Mix 400 g  93.21` reads `**Chamak Glass Cleaner 500 ml  68.03**` — exactly the row the
review predicted. Regex `\b[0-9a-f]{8}\b` over the whole screen: **0 matches**.
`wave3-web-walks-webdesk-dos013-prices.png`.

**Not walked:** the DOS-006 credit-release sentence. This database holds **no pending `credit_limit`
approval** (3 approved, 1 rejected, 2 expired; the only pending rows are 2 bargains), which is the stale-seed
condition the review's own minor predicted. Listed under "Still not proven".

---

## 5. lean-manager-order-lifecycle — the put-back group, and the blocker

**W5 "Put back" — PASS on web.** Built the case: a two-order wave PICK-0080 (SO-0870 14 lines + SO-0873 13
lines, 321 pc), started it, picked **4 of 8 pc** on one SO-0873 line, then had the DESK cancel SO-0873
mid-pick (200, `cancelled`). Database truth first: all **13** SO-0873 `pick_lines` rows have `cancelled_at`
set. Then the warehouse screen, measured from the rendered text:

- a **"Put back"** group heading,
- **12** rows reading `Not needed — the order was cancelled` (the untouched lines),
- **1** row reading `**Put back 4 pcs · SC20260521**` — the picked line, naming the pieces and the batch,
- the sheet header reads `**0 of 14 picked**` — the progress counts only the live order; the cancelled
  order's 13 lines and its 4 picked pieces are out of the count,
- the footer explains `A wave is cancelled by the manager.`

`wave3-web-walks-webdesk-w5-putback.png`.

**The cancel-mid-pick dialog — PASS.** Manager → Orders → Being picked → SO-0872 → Cancel order: the dialog
carries the picker sentence `**The picker will be told which lines to put back.**` above the reason field.
`wave3-web-walks-webdesk-dos138-cancel-picking-dialog.png`. Its two buttons are `["Cancel","Cancel order"]` —
filed as **S-178**.

**DOS-145 (header search finds a bill) — PASS.** Typing `INV/0366` in the manager header fires
`/retailers?q=`, `/orders?q=` and `/invoices?q=`; clicking the suggestion navigates to
`/billing?view=bills&bill=6bc72f37-1545-7a72-8a77-5317256e441e&q=INV%2F0366` — the **Bills issued** tab with
the panel open (`Bill INV/0366 · Balaji Wholesale Stores · 23 Jul 2026 · Paid · ₹45,511.00`). Pressing
**Enter** instead does nothing — filed as **S-179**. `wave3-web-walks-webdesk-dos145-bill-search.png`.

**Blocker 1 (a cancelled wave must not be revived by `start`) — PARTLY PROVEN. Read this carefully.**

What I proved by execution:

1. **The hook path is safe.** Single-order open wave PICK; manager cancels the only order → the sheet was
   ALREADY `cancelled` before `start`, with `cancel_reason` "every order on it was cancelled: …". `start`
   then answered **409**, a second `start` answered **409 "picklist … is cancelled"**, and the sheet stayed
   `cancelled` with its 24 lines intact. No zombie.
2. **The rep cannot reach the dangerous state on a STARTED wave.** `POST /sales/orders/{id}/cancel` on a
   picking order answers **409 `desk_only`** — "order SO-0873 is being picked; only the desk can cancel it
   now" — and the sales app offers no cancel control on such an order at all (measured: the order screen's
   buttons are the five lines plus "My orders").

What I could NOT reach: the exact blocker-1 state — an **open** wave whose only order a rep cancels from the
sales app, with no `PicklistsService` in that container. Three attempts failed on data, not on the guard:
SO-0877's cancel went through the manager (hook ran); SO-0868 and SO-0867 were both held on pending
approvals so the wave 409'd at `create` ("only a confirmed order can be waved"), and cancelling them left
the pool empty; the only confirmed order remaining (SO-9003, Vitthal Traders) has **no salesperson and no
retailer link**, so no app role can cancel it. The guard at `picklists.service.ts:478-490` is present in the
tree and reads correctly, but I did not execute it. Listed under "Still not proven".

**`cancelledAt` is missing from the online read — S-180**, measured: the DB has `cancelled_at` on all 13
lines, `GET /warehouse/picklists/{id}` returns 20 keys per line and `cancelledAt` is not one of them.

---

## 6. lean-sales-rep — beat, schemes, cancel dialog, honesty

**DOS-084 (today's beat) — PASS, with the weekday arithmetic.** Home opened on `**✓ Station Road**`.
Today is **Monday 21 Sep 2026** (ISO weekday 1). Of the three beats offered, `visit_days` are
Station Road `[1,4]`, Kalyan West Market `[2,5]`, Khadakpada `[3,6]` — only Station Road contains 1.
The chip **survived a reload** (`✓ Station Road` before and after).
`wave3-web-walks-webphone-sales-home-beat.png`.

**DOS-088 (the scheme count is the live count, no slice) — PASS, verified against the database.**
Shree Ganesh Kirana's card: "Schemes this shop is in — **12 live today.** The price screen applies them."
`select count(*) from schemes where active and valid_from <= '2026-09-21' and valid_to >= '2026-09-21'`
= **12** (of 19 total, 18 active). The full list renders, not a slice.
`wave3-web-walks-webphone-dos088-shop-card.png`.

**DOS-092 (the cancel dialog) — PASS, at the wire.** On SO-0879, the order I placed: buttons are exactly
`["**Keep it**","**Cancel the order**"]` under "Order SO-0879 for Balaji Wholesale Stores will be cancelled
and its stock released." Confirming with an EMPTY reason made **no POST** (`POSTs = []`) and showed the field
error "**Type why, so the office and the shop know**".
`wave3-web-walks-webphone-dos092-{cancel-dialog,cancel-empty-reason}.png`.

**The DOS-086 blocker's copy — PASS.** The placed panel reads
"**Order placed — The office has it, with its number and its price.**" beside the warn chip
"35 days overdue (warn only)". The forbidden sentence "Submit it from My orders" does not appear.
`wave3-web-walks-webphone-dos086-placed-panel.png`.

**S-151 re-measured and DISPROVEN — filed as S-182.** All four tabs now carry
"Updated just now · **Not kept in this browser**"; the Beat screen adds "This browser will not keep the
offline copy after you close it". S-151 said only Beat did. Its second half (the order screen's
"Save on this phone" label over a memory store) was not re-reached and stays open.

---

## 7. lean-sales-orders-pricing — DOS-083 passes; DOS-079 is worse than the review knew

**DOS-081 (warn-mode credit) — PASS.** Balaji Wholesale Stores' card reads
"**Headroom ₹2,79,196.00 · Warn at the limit**" online; after placing, the panel chips
"**35 days overdue (warn only)**", and the order's `credit_notice` in the database carries
`{"reasons":["overdue_days_exceeded"],"creditMode":"indicate","overdueDays":35,…}` with the order
**confirmed**, not held. Warn means warn.

**DOS-083 (the rep reads the payable) — PASS.** The bottom bar read "Items 2 · **₹1,360.00 the shop pays**",
and the order the server wrote is `subtotal 121392 + tax 14567 → total **136000**`. The figure on the phone
is the payable, to the paisa. `wave3-web-walks-webphone-dos083-order-footer.png`.

**DOS-079 (the rep's total is the bill's total) — FAILS, and not only in the seed. Filed as S-176, P1.**

I placed a real order through the browser (SO-0879, 1 cs Campa Cola 750 ml + 1 cs Campa Cola 1 L) and then
read what the server stored:

| | measured |
| --- | --- |
| SO-0879 lines | `gst_bps **1200**, cess_bps **0**, cess_paise **0**` on both |
| SO-0879 header | `subtotal 121392, tax 14567 (**12.00 %**), cess_paise 0, total 136000` |
| the SAME variants on `invoice_lines` | `gst_bps **2800**, cess_bps **1200**, cess_paise > 0` |
| database-wide | `sales_order_lines` with cess: **0 of 6 497** · `invoice_lines` with cess: **2 748 of 6 203** |

Root cause, found by query: **`hsn_rates` holds three rows for HSN 2202**, all `effective_from 2017-07-01`
with `effective_to` NULL, because three different goods share that HSN —
"Packaged drinking water" 1800/0, "Fruit pulp / fruit juice based drinks" 1200/0, and
"Aerated waters, containing added sugar (Campa)" **2800/1200**. The lookup key is `hsn_code` alone, so it is
ambiguous, and the ORDER path resolves it to the fruit-juice row while the INVOICE path resolves it to the
aerated row.

Consequence in money: the shopkeeper was quoted **₹1,360.00**. At 28 % + 12 % the same net bills at
₹1,213.92 × 1.40 = **₹1,699.49** — an under-quote of **≈ ₹339, about 25 %**, on every aerated-drink order.

Why this matters for the merge: the lean-sales-orders-pricing review's blocker 1 named only
`seed-demo/sales.ts` and `seed-demo/billing.ts` and asked the integrator to write `cessBps`/`cessPaise` into
the seed. **That fix alone would make the seeded rows look right while the runtime kept under-quoting**,
because the fault is in the rate lookup, not the fixture. The condition the review made conditional has been
tested, and the answer is: do not apply the seed-only fix on its own.

---

## Still not proven

1. **Android and iOS — every claim of every lane.** Nothing was booted: free RAM **226 MB** and swap
   **85.2 %** at the start, **60 MB** free at the worst point, both past this block's refusal thresholds.
   Owed on a device: DOS-069's number pad under a real RN `Modal` with a nested `SafeAreaProvider` on API 36
   edge-to-edge (the one thing the kit-polish source-reading specs explicitly do NOT prove), including the
   Done/Clear row against the gesture bar and once against 3-button nav; DOS-150's `content-desc "Not
   entered"` in a `uiautomator` dump; DOS-038 on the native `ListRow`; DOS-092's field error under the native
   `TextInput`; the W5 put-back group re-snapshotting on the new schema hash; DOS-086's kill-and-relaunch
   catch-up sweep on real SQLite; and every iOS in-Sheet dialog (DOS-164).
2. **lean-delivery-collect — the whole lane. NOT WALKED AT ALL.** The stop screen (D3 overdue chips, D5
   office balances and the "as billed" label at 360 px, D4 photo gate, D7 expense gate, D9, D11, D12) was
   never opened in this block; the delivery Metro was never started, because the five apps above consumed
   the time and the machine could not hold two Metros at once. Nothing about it is claimed here.
3. **Blocker 1's exact state** (open wave + rep cancel + no hook) — see §5. The two neighbouring states were
   proven safe; the guard itself was not executed. It needs a confirmed order owned by a salesperson and a
   free wave: make one with `orders.create` + `submit` as the rep rather than reusing seeded orders, which
   is what defeated me.
4. **DOS-006's credit-release sentence** — no pending `credit_limit` approval exists in this database
   (3 approved / 1 rejected / 2 expired). The review's own minor predicted exactly this and prescribed
   `delete from approvals where kind = 'credit_limit' and payload ? 'requestedLimitPaise';` then a re-seed.
   Not run: re-seeding would have destroyed the live data the other walks needed.
5. **DOS-011's cash-discount sentence** on owner RCPT-0699, and the Orders → Export CSV round trip with a
   worker actually rendering the file. Not reached.
6. **DOS-086's offline straddle** (>50 queued ops so a header and its lines land in different batches, via
   the browser's own offline mode) — not run. The online half of DOS-086 (the placed copy) is proven.
7. **DOS-078, DOS-087, DOS-090** of lean-sales-orders-pricing — the shortage panel, the per-case-off line
   and the rate request tied to an unplaced draft. Not reached.
8. **S-151's second half** — the order screen's "Save on this phone" label over a memory store. The
   cross-tab half is disproven (S-182); this half was not re-reached.
9. **Nothing was measured on any database other than `dos_test_b2_walks`.** `dos` and `dos_qa` were never
   connected to.
