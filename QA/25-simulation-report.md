# Business simulation — report for the founder

Run: 21–27 September 2026 · design: `QA/24-simulation-design.md` · evidence: branch `qa/simulation`
(`QA/evidence/simulation/`: the world file, one action log per day, three audits, the owner UX walk).

Everything here ran on a copy of the **demo** data (`dos_test_sim`). Your live data (`dos_live`) was never
part of the simulation.

## 1. What was run

Eight business days of Tarsun, played in the one app in a real browser, as the people who do the work: the
owner, the manager, the accountant, two reps, the godown, two van crews and a shop. About 500 logged actions:
orders, holds and approvals, picks, packs, bills, load-outs, deliveries (full, part, refused), cash / UPI /
cheque receipts, van sales, van check-in, trip settlements, day-end banking, goods receipts with batches and
expiry, credit notes, a bill cancel, a stock write-off.

After each day, every P0 and P1 the day found was fixed, verified by a second agent that had not seen the fix
being built, merged, and **used the next day** on the same data.

## 2. Verdict: the books balance

A blind auditor recomputed the books from SQL three times, trusting no number in the day logs.

| Check | Result |
| --- | --- |
| Stock, every batch at every place (363 batch-places over 121 batches, dock and vans included) | closes to the piece |
| Money for the week: bills − credit notes = receipts + change in dues | ₹2,82,680.00 − ₹19,900.00 = ₹2,24,989.00 + ₹37,791.00 |
| Dues per shop: documents = open bills = Sundry Debtors | 65 of 65 shops agree |
| Van cash per trip | nets to zero on 9 of 9 trips |
| Journal | 0 unbalanced entries, trial balance totals 0 |
| Owner's screens (Today, Money, Trial balance, Stock) | equal SQL |

The first audit found one drift: **12 pieces of Toor Dal that did not exist** (DOS-257). A bill cancelled on
day 6, before that day's fix, had "returned" pieces the dock no longer held. It is closed three ways: the
owner wrote the 12 off in the app (day 8), the database now refuses any cancel that would invent stock, and a
release check (`pnpm check:stock-cancels`) names any such bill before a deploy.

## 3. What it found

52 findings. **All 7 P0 and all 19 P1 are fixed and on main**, plus 5 smaller ones.

| Severity | Found | Fixed | Open |
| --- | --- | --- | --- |
| P0 (money or stock wrong) | 7 | 7 | 0 |
| P1 (the work cannot be done) | 19 | 19 | 0 |
| P2 | 18 | 2 | 16 |
| P3 | 8 | 3 | 5 |

### The seven P0s, in plain words

| Id | What was wrong | Now |
| --- | --- | --- |
| DOS-227 | "Repeat last order" priced 18 pieces and booked 3 | books what the screen priced |
| DOS-239 | Van sale counted pieces and called them cases | pieces are pieces, cases are cases |
| DOS-242 | A short or returned line with a scheme was credited at the pre-scheme rate (shop over-credited) | credited at what the shop was billed |
| DOS-245 | A credit note on an already-paid bill vanished from the shop's dues | sits on the shop's account as money on account |
| DOS-251 | Cancelling a packed bill whose pieces had left the dock created stock | refused, with the reason |
| DOS-252 | A line picked 0 was billed and moved in full | not billed, not moved |
| DOS-257 | 12 pieces left behind by a cancel made before DOS-251 | written off; guarded in the database |

### The P1s, by area

- **Stock in:** type a supplier's paper bill (DOS-213); post a counted receipt from the desk (DOS-217); batch
  and expiry on the gate count (DOS-220); the purchase reaches the books (DOS-221); stock at cost uses the
  receipt's cost (DOS-222); no green "Saved" before the server said so (DOS-216).
- **Prices:** price lists, shop overrides and schemes can be added, edited and withdrawn from both desks
  (DOS-214).
- **Delivery and vans:** second bill of a two-bill stop (DOS-232, 237); van-sales trips (DOS-233) and van
  sale for cash (DOS-240); van check-in (DOS-234); settling a trip with a variance (DOS-235); a bill that came
  back can go out again (DOS-241, 244, 248); the dock keeps each bill's pieces apart (DOS-247).
- **Owner's numbers:** stock by item and batch (DOS-253); sales and margin net of credit notes (DOS-254).

## 4. The owner's app — what changed

A reviewer walked all 26 owner screens at desk and phone width after the week and checked 13 figures against
SQL (all equal). The problems were what was missing or hard to find, not wrong numbers. Fixed and on main:

| Id | Change |
| --- | --- |
| UX-O-1 | **Today's flow** on the home: Booked → Held → Billed → Packed, no van → On the road → Delivered → Collected → Banked → Owed. Each step shows count and ₹, opens its register, and turns ochre when it holds anything older than a day |
| UX-O-2 | Expired batches say **Expired**, not Sellable; an Expired filter; "Expired, still in the godown" on the home |
| UX-O-3 | The home's tiles open the register behind the figure; a trip names how long it has been out; failed stops are shown |
| UX-O-4 | This month against the **same days** of last month |
| UX-O-5 | Receipts: a Today chip, a Banked filter, and the split by cash / UPI / cheque |
| UX-O-6 | Money owed opens on the shops that owe, with "Show all"; money on account and net dues per shop (DOS-260) |
| UX-O-7 | A shop's panel: phone, last payment, and each bill's date, what is left of it and how many days late |
| UX-O-8 | Credit notes, supplier bills, receipts of goods, exports and messages list newest first |
| UX-F-5 | **Show / Hide** on every password field |
| UX-F-1, 2, 4 | Money owed scrolls; a bill opens with its items; Change password opens (done 26 Sep) |

## 5. Open, for your decision

### Needs a ruling from you

| Id | Question |
| --- | --- |
| DOS-219 | A scheme saved "On its own" still gets the bill-level scheme on top. Should "On its own" mean no other scheme at all? |
| DOS-261 | Expired batches can still be reserved for an order once in-date batches run out. Block them from sale automatically? |
| DOS-256 | UPI receipts never reach "banked": day-end banks cash and cheques only. How should UPI be settled — automatically the same day, or ticked at day-end? |
| DOS-225 | Every order of a pay-on-delivery shop is held "for credit". Should pay-on-delivery orders skip the credit hold? |
| UX-O-8 | Catalogue and price lists: sort by brand, then item A–Z? (Your ruling of 21 Sep says lists are newest first; a catalogue has no date.) |

### P2, no ruling needed (say which you want first)

| Id | What |
| --- | --- |
| DOS-218 | Owner's what-if price check takes typed ids; it needs a shop and item picker |
| DOS-223 | Godown stock screen shows the first 200 batches only |
| DOS-226 | A second rep on a shared beat cannot see the shop's orders or repeat one |
| DOS-229 | Pick sheet is not consolidated by item |
| DOS-230 | Bill PDF prints the UPI id as text, no QR |
| DOS-231 | Pieces shorted as "damaged carton" stay sellable |
| DOS-243 | Late money on a settled trip: the phone refuses but does not say "hand it to the cashier" |
| DOS-246 | Owner's Money line says it matches the trial balance when it can differ |
| DOS-249 | A bill taken off a trip still counts in the stop's "to collect" |
| DOS-250 | The same upload sent twice at the same instant is applied twice |
| DOS-255 | Tally export carries no contra or journal vouchers |
| DOS-258 | After a short settlement, day-end banks the receipt at face value |
| UX-O-9 | Approvals show no age, and a bargain does not show its item |
| UX-O-10 | Orders: counts on the state chips, "waiting on a van · 15 d" |
| UX-O-11 | Shops list: "Owes" and "Overdue" columns |
| UX-O-13 | Stock: an item's batches in expiry order with an item total |
| UX-O-14 | Books: explain "Cash with delivery crews" against the home's cash in transit |
| UX-O-20 | Shop's behaviour panel shows stale "last order" |
| UX-O-21 | Searching a shop lands on Shops without its bills |

P3 (polish): DOS-224, 228, 236, 238, 259 and UX-O-15 to 19, 22.

Unverified code for UX-O-20, UX-O-21 and the A–Z catalogue exists on branch `worktree-wf_be1f8178-550-24`
(commit `7794c0cf`); it was not merged.

## 6. Database changes made by the fixes (all expand-only)

| Migration | What |
| --- | --- |
| 0066, 0067 | Batch and expiry on goods-receipt lines; the purchase journal |
| 0068 | The dock holds each bill's pieces apart |
| 0069, 0070 | Credited amounts in the daily rollups |
| 0071 | A cancelled bill must net to zero stock (checked at commit) |
| 0072 | Writes off stock an old cancel invented; on live data it finds nothing to write off |
| 0073 | Indexes behind the newest-first lists |

## 7. What the simulation did not cover

- iOS. Android and the website only.
- Real GST e-invoicing, e-way bills and WhatsApp sending (no live credentials).
- Reading supplier bills by AI (no Anthropic key on the server yet); goods receipts were typed.
- More than one distributor at a time, and load (many users at once).
