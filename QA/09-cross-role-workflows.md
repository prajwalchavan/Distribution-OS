# Cross-role workflows — one order, end to end

Phase 2 of the QA programme (`QA/PHASES.md`). One order is followed through seven hands, each acting **in
that person's own app** (`QA/24-simulation-design.md` §3), and at every hand-off the question is the one the
phase asks: *did the next person get what they needed?* Nothing here was done through the API except three
labelled refusal probes in hop 4, which exist to prove a rule and write nothing.

**Stage.** Worktree `.claude/worktrees/b2-chain` on main `fd5d86b`. Database `dos_test_chain`, created from
`dos_test_batch2b_template`, migrated and seeded. Backend: the all-in-one on **:3200** with the worker
in-process (`DOS_MODE=all WORKER_INLINE=1 ALL_IN_ONE_PORT=3200`) — `GET /health` answered
`{"status":"ok","mode":"all-in-one", … eight services}` and `GET /sales/health` `{"ok":true,"db":"up"}`; the
worker announced its queues at 08:36:11 and rebuilt three tenants' ageing on start. Apps: one Expo web server
at a time on 5273–5279 (free RAM was ~34 MB and swap 84.9% at the start, so the headroom rule applied: start,
walk, stop). Driven by Playwright over one headless Chromium — **1280×800 for the desk roles, 390×844 as well
for sales and delivery**.

**The order.** SO-0879 · Shree Ganesh Kirana (R-0001, Station Road) · placed 21 Sep 2026 08:45 IST ·
**₹10,148.00**.

| | | |
|---|---|---|
| Subtotal | ₹8,598.28 | `sales_orders.subtotal_paise = 859828` |
| Scheme discount | −₹408.17 | `discount_paise = 40817` |
| Taxable | ₹8,190.11 | CGST ₹770.04 + SGST ₹770.04 |
| Cess | ₹417.99 | `cess_paise = 41799` |
| Round off | −₹0.24 order / −₹0.18 invoice | |
| **Total** | **₹10,148.00** | `total_paise = 1014800` |

**The hand-offs, at a glance.**

| # | Hand | Did the next person get it? |
|---|---|---|
| 1 | Sales → Manager | **Yes.** Same order number, same ₹10,148.00, same reason flag, within seconds. |
| 2 | Manager/Owner → Warehouse | **Yes.** "SO-0879 · Station Road · 134 pc confirmed" in the pick queue. |
| 3 | Warehouse → Planning board | **Yes.** INV/9007 · ₹10,148.00 on the trip-plan sheet. |
| 4 | Load sheet → Driver | **Yes.** TRIP-0001, one stop, ₹10,148.00 — *after a manual reload* (DOS-190). |
| 5 | Delivery → Retailer | **Yes.** Bill, both receipts, new outstanding ₹35,843.00 — the same rupees. |
| 6 | Desk/Accountant → Owner | **Partly.** Revenue and outstanding match SQL to the paisa; **the stock movement is unreachable** (DOS-186). |
| 7 | Tenant → Admin console | **Yes.** Counts match SQL; one rupee figure on the page and it is the platform's own subscription. |
| — | The scheme the shop was promised | **No, at every hop.** Five free bottles priced and then never picked, billed or delivered (DOS-185). |

---

## Hop 1 — Rahul Deshmukh, salesperson, at the shop

**Phone (390×844) and desk (1280×800).** `rahul.deshmukh` opened today's beat: *Station Road · Shops 10 ·
Visited 0 · Ordered 0*, ten shops with their last order date and what each owes. He opened **Shree Ganesh
Kirana**, which the app framed honestly before he sold anything:

> Owes ₹35,843 · Limit ₹50,000 · Overdue ₹35,843 — **Headroom ₹14,157.00 · Strict** — 6 open bills, credit
> days 7, "Pay after delivery", and the twelve schemes the shop is in today.

He recorded the visit (outcome **Ordered**). Written: `visits` row `01a0c1f0-e290-7389-b9dd-653c118b63fe`,
`outcome = ordered`, `started_at 2026-09-21 08:40:11 IST`. *(The sheet then stayed open on top of the "Take
order" button — S-171.)*

**Taking the order.** The catalogue showed the live ATP beside every item — "Campa · 24 pc case · **19 cs
available**" — and the figure stayed on the cart line as he built it.

| What he did | What the screen said |
|---|---|
| Add a case of Campa Cola 1 L | "Items 1 · **₹766.00** the shop pays" |
| + to 5 cases | "5 cs = 120 pc · 19 cs available", **−₹102.60**, "Schemes on this order −₹102.60" |
| Pieces → 126 | "5 cs + 6 pc = 126 pc", scheme **−₹107.73**, footer ₹3,901.00 |
| Add 1 case Godavari Cow Ghee 1 L | ghee **−₹300.44**, "Schemes on this order **−₹408.17**", footer ₹10,148.00 |

The price engine is visible while he sells, not after: 126 pc × ₹28.50 = ₹3,591.00 gross, 3% off on 5+ cases
= −₹107.73 → ₹3,483.27; ghee 8 pc × ₹625.91 = ₹5,007.28, 6% exclusive = −₹300.44 → ₹4,706.84. Both land in
`sales_order_lines.applied_rules` as `line_pct` rules with those exact paise (10773 and 30044).

Before he could submit, the cart told him the consequence: **"Will be held for credit — 46 days overdue"**.
He added a note ("QA chain hop 1 - deliver before 6pm"), placed it, and got **"Held for credit — The office
decides before it ships."** The order screen showed **SO-0879 · Submitted · Credit limit · Nobody has
decided yet · Pending**, with the note carried through.

**SQL behind it.** `state = submitted`, `approval_flags = ["credit_limit"]`, `source = salesperson`,
`pricing_date_mode = order`, and the real reason recorded separately:
`credit_notice = {"reasons":["overdue_days_exceeded"],"creditMode":"strict","overdueDays":46,
"headroomPaise":400900,"creditLimitPaise":5000000,"outstandingPaise":3584300}`.

**What the order did NOT carry.** Line 1's `applied_rules` also holds a third rule —
`{"rewardKind":"free_qty","freeQty":5,"freeVariantId":"f71bf137-…"}`, five free bottles of Campa Cola 750 ml
from the live scheme *"Campa 750 ml / 1 L — a bottle free per case"*. The same row's `free_qty_pcs = 0`, the
order has two lines and neither is the free item, and the rep's cart never named it. It does not reappear at
any later hop. **DOS-185.**

### Hop check 1 → the manager's queue

`vikas.kadam`, manager app, Orders. Today read *"Orders to confirm — 3 rows — ₹33,251.00"*, and the queue's
first row was:

> SO-0879 · Shree Ganesh Kirana · Rahul Deshmukh · **10,148.00** · Submitted · Over credit limit · **Over
> limit · held** · 21 Sep

Opening it gave the lines back unchanged — Campa Cola 1 L 126 pc ₹4,876.58, Godavari Cow Ghee 1 L 1 cs · 8 pc
₹5,271.66, Subtotal ₹8,598.28, Discount ₹408.17, Tax ₹1,958.13 (includes cess ₹417.99), **Total ₹10,148.00**
— the rep's numbers to the paisa. **Nothing lost, nothing delayed, nothing different.**

One thing *was* different: the reason. The drawer labelled it "Over credit limit" and then wrote *"This order
takes it ₹0.00 over the limit"* — true, because ₹35,843 + ₹10,148 = ₹45,991 against a ₹50,000 limit. The
order is held for **46 days overdue**, which the drawer mentions only as a quiet second line. **DOS-188.**

---

## Hop 2 — the decision: Sunil Tarsun, owner

The approval is a credit approval, so it was taken by the **owner**. `sunil.tarsun` → Today → Open approvals →
the SO-0879 row. The owner's detail states the reason correctly where the manager's did not:

> Kind **Over credit limit** · Person Rahul Deshmukh · Asked 21 Sep, 8:45 am · Order SO-0879 ₹10,148.00 ·
> Credit: **Owes ₹35,843.00 · limit ₹50,000.00 · Oldest bill 46 days past due · terms 7 days**

He wrote a note and pressed Approve. The confirmation sheet made the founder's rule explicit on the screen:

> This is the last decision: SO-0879 will be confirmed and its stock held.
> Approving lets SO-0879 through for ₹10,148.00. **The limit stays ₹50,000.00 — change it under Shops.**

**Proved after the fact.** `approvals`: `status = approved`, `decided_by = sunil.tarsun`, `decided_at
2026-09-21 08:51:42 IST`, note stored. `sales_orders`: `state = confirmed`, `confirmed_at
08:51:42.95`. And the shop's credit row, read again: `credit_limit_paise = 5000000`, `credit_mode = strict`,
`credit_days = 7` — **unchanged**. One order was let through; the limit was not raised to let it through.

Stock was held in the same transaction: **19 `reservations` rows**, `state = pending` — Campa Cola 1 L 126 pc
across 14 lots, Godavari Cow Ghee 8 pc across 5 lots. (No reservation for the five free bottles.)

### Hop check 2 → the warehouse

`dinesh.patil`, warehouse app, Pick. Orders waiting listed **"Shree Ganesh Kirana · SO-0879 · Station Road ·
134 pc · confirmed"** — 126 + 8, the same two lines. **Yes.**

---

## Hop 3 — Dinesh Patil, warehouse: pick, pack, bill

**The wave.** He ticked SO-0879 alone ("1 selected · 134 pc") and built **PICK-0079**: 19 lines, *consolidated
by SKU and ordered by expiry*, with batch, expiry and MRP on every line and no cost anywhere.

**Why those lots — FEFO, measured.** The sheet walks Campa Cola 1 L from **RCP20260529, exp 23 Feb 2027, 5 pc**
upward through RCP20260605 (2 Mar) · RCP20260612 (9 Mar) · B20260614 (11 Mar) · RCP20260619 (16 Mar) ·
RCP20260626 (23 Mar) · RCP20260703 (30 Mar) · RCP20260710 (6 Apr) · RCP20260717 (13 Apr) · RCP20260724
(20 Apr) · RCP20260731 (27 Apr) · RCP20260807 (4 May) · RCP20260814 (11 May) to **B20260909, exp 6 Jun 2027,
2 cs + 9 pc = 57 pc**; then ghee GD20260614 (14 Jun) → GD20260620 → GD20260723 → GD20260726 → GD20260806
(6 Aug 2027). The quantities sum to 126 and 8. SQL over `pick_lines` joined to `stock_lots` returns the same
19 rows in the same expiry order: **the earliest-expiring lot is drained first, and the big fresh lot only
covers the remainder.** That is the rule and it held.

**No cost leak.** The only rupee on the picker's sheet is ₹50.00 / ₹770.00 per line — `stock_lots.mrp_paise`
(5000 and 77000), the price printed on the pack, not the purchase cost.

He picked all 19 lines at full quantity (`sum(picked_qty_pcs) = 134 = sum(requested_qty_pcs)`), took it to
packing, and pressed **Pack and bill** on a dialog that warned: *"1 cartons leave the godown for Shree Ganesh
Kirana. The bill is issued in the same step and cannot be edited afterwards."*

**The bill.** `INV/9007`, series INV, FY 2026-27, issued 21 Sep 2026 08:58:33, due **28 Sep 2026**, state
`issued`, `total_paise = 1014800`. Order `state = packed`. Stock relieved in the same transaction: 19
`stock_ledger` rows, reason `sale`, ref_type `pack`, **−134 pieces from the Godown**, and `stock_balances`
moved with them (lot B20260909 → 336 on hand, `version 4`, `updated_at 08:58:33`).

**The PDF.** `pdf_object_key` was empty at issue and filled by the **worker** about a minute later —
`tenant/01a0999a-…/documents/invoice/01a0c202-….pdf`, 23 013 bytes. Text extracted from it:

> **Tarsun Enterprise** · M/s. Tarsun Enterprise · GSTIN 27CNGPP9039R1ZX · INVOICE · Original for Recipient ·
> Invoice no **INV/9007** · Invoice date 21-Sep-2026 · Due date 28-Sep-2026 · Bill to Shree Ganesh Kirana,
> Shop 3, Station Road … 19 lines, each with its batch, expiry and MRP, HSN 2202 / 0405 …
> Subtotal 8,598.28 · Discount −408.17 · Taxable value 8,190.11 · CGST 770.04 · SGST 770.04 · Cess 417.99 ·
> Round off −0.18 · **TOTAL Rs 10,148.00** · "Rupees Ten Thousand One Hundred Forty Eight Only" ·
> Pay by UPI to tarsun@okhdfcbank … · **Tarsun Enterprise — Wholesale & Distribution · GSTIN 27CNGPP9039R1ZX**

**Its own name and its own logo.** The footer string is `tenant_settings['branding.invoice_footer']` verbatim,
the header name is `branding.display_name`, and the document embeds one image XObject —
`/Type /XObject /Subtype /Image /Width 360 /Height 150 /ColorSpace /DeviceRGB` — the tenant's own
`branding.logo_object_key`. No Distribution OS mark anywhere on it.

The PDF has no free-goods line either.

### Hop check 3 → the planning board

The warehouse's own Load board listed **"Shree Ganesh Kirana · SO-0879 · Cartons 1 · Packed 21 Sep, 8:58 am ·
INV/9007"** — correct, but with **no amount**; that board is in cartons. The amount appears the moment a trip
is planned from it: the plan sheet's "Packed bills not on a trip" reads **"Shree Ganesh Kirana · INV/9007 ·
Station Road · ₹10,148.00"**, and the manager's own load-out board later showed the same bill as "On board ₹
**10,148.00**". **Same amount. Yes.**

---

## Hop 4 — the trip: plan, load sheet, the manager's approval, departure

**Planned from the warehouse board (W10).** Vehicle MH-05-CD-5678, driver **Ganesh More**, helper Iqbal
Shaikh, cash float ₹2,000, the INV/9007 bill ticked. The confirm read *"MH-05-CD-5678 for 21 Sep? Ganesh More
· 1 stops · 1 bills"* and wrote **TRIP-0001**: `trip_date 2026-09-21`, `state planned`, `planned_stops 1`,
`opening_cash_paise 200000`, one `trip_stops` row for R-0001 with **`planned_collection_paise = 1014800`**.
*(Nothing in the plan panel shows which row is selected — S-173.)*

**Start loading** moved it to `loading` and the screen said who may take it out: *"The driver starts the trip
from the delivery app once the load sheet is counted out."*

**The load sheet.** Built from the Load screen: 19 lot lines with batch and expiry, **Declared value
₹10,148.00**, `expected_packages 1`, `status draft`, `load_value_paise 1014800`. The godown screen locked
itself: *"Waiting for the manager — A manager approves this sheet from the manager app. This screen unlocks
the moment it lands."*

**The manager's approval IS the PIN.** `vikas.kadam` → Fulfilment → Load-out, which says so in one line:

> **Your approval IS the PIN, and it is given here — nothing is typed on the warehouse phone but the count.**

The row read *21 Sep · MH-05-CD-5678 · **Waiting for your approval** · 1 order · 1 package · Counted — · On
board ₹10,148.00*. He approved it with a note; the sheet then read *"Approved · the godown may check it out —
Approved by Vikas Kadam, 21 Sep"*, and `load_sheets.approved_by = a1cbd424-…` (Vikas Kadam), `approved_at
09:10:31`, `status` still `draft`.

**The crew count.** Back in the godown, the sheet now offered a keypad, "Cartons on the vehicle". Dinesh
counted **1**, the screen showed **Expected 1 / Counted 1**, and checking out wrote `status = confirmed`,
`counted_packages = 1`, `confirmed_at 09:14:12`, **challan DC-0083**. *(The dialog claims "Stock moves to the
vehicle"; no transfer rows were written, because the goods were already relieved at pack — S-172.)*

### Two rules proved, not assumed

Both were probed directly against the running services, as refusals. Neither wrote anything.

1. **The warehouse cannot send a van out.** `POST /warehouse/delivery/trips/{TRIP-0001}/depart` as
   `dinesh.patil` → **HTTP 403**, body: *"the warehouse role may not call POST /delivery/trips/:id/depart"*.
   That matches the matrix (`delivery.trips.depart` = `DOORSTEP` = owner, manager, delivery) and the app: the
   warehouse trip card offers no depart control at all, only the sentence quoted above.
2. **Nothing departs past a draft sheet.** Before the count-out, `POST /delivery/delivery/trips/{TRIP-0001}/depart`
   as **`ganesh.more`** (who *is* allowed) → **HTTP 409**: *"the load sheet of trip TRIP-0001 has not been
   counted out at the godown yet; the vehicle leaves after the load-out check"*, `data.code =
   load_sheet_not_confirmed`. The trip stayed `loading`. The gate is in the server, not only in the screen.

**Departure, by the crew.** `ganesh.more` opened TRIP-0001 in the delivery app: location consent already given
("You agreed on 13 Aug, 9:00 am"), odometer 48210, cash handed ₹2,000. The confirm read *"TRIP-0001 on
MH-05-CD-5678, 1 stops, float ₹2,000.00. You leave with the bills the godown counted out on this trip…"* →
`state = active`, `started_at 09:17:24`, `start_odometer_km 48210`.

### Hop check 4 → the driver's app

Immediately after the tap, home showed **the wrong trip** — TRIP-ACTIVE (12 Sep), with TRIP-0001 below it
still labelled "Being loaded". A reload fixed it (**DOS-190**). After the reload:

> **TRIP-0001 · 21 Sep 2026 · Today's trip · On the road · 0 of 1 stops · MH-05-CD-5678 ·
> STILL TO COLLECT ₹10,148.00 · FLOAT AT START ₹2,000.00**

and the stop itself: *Stop 1 of 1 · Shree Ganesh Kirana · **Bills on this stop: INV/9007 · 21 Sep 2026 ·
₹10,148.00***. **Yes — the trip, the stop and the amount.**

---

## Hop 5 — Ganesh More, delivery crew, at the door

**Phone (390×844) and desk (1280×800).** The stop screen led with the money, before any goods:

> Owes **₹45,991.00** · Overdue **₹35,843.00** · oldest due 6 Aug · **46 days late on the oldest bill** ·
> **7 bills still open at this shop**

— the new bill folded into the total the moment it was issued. **Overdue dues are shown, first thing.**

**"I am at the shop"** → `arrived 21 Sep, 9:18 am`. **Deliver** opened the 19 lot lines pre-filled at full
quantity, *Dropping 134 / 134 · ₹10,148.00*, and refused to go further: *"This shop is on credit — **a photo
is required** before you can record it."* A photo was attached (the web build opens a file picker), the
receiver name and a note typed, and the delivery recorded.

Written: `deliveries` `outcome = delivered`, `delivered_at 09:20:11`, `receiver_name "Ganesh Kirana - Ramesh"`,
`idempotency_key sync:delivery:…`; `pod_evidence` `kind = photo` pointing at
`tenant/…/pod/004d0157-…/01a0c215-ea23-….jpg`, 130 bytes on disk. *(The first upload attempt was refused by
CORS and retried; one orphan `file_objects` row remains — S-170.)*

**Collecting — part cash, the rest UPI.** The collect screen warns before you take anything: *"Untagged, the
office puts this on the oldest of the 7 bills this shop still owes — not always the bill in your hand."* He
tagged INV/9007 both times.

| | Mode | Amount | Reference | Book no. | Receipt |
|---|---|---|---|---|---|
| 09:21:45 | Cash | **₹6,000.00** | — | RB-2209-01 | **RCPT-9005** |
| 09:22:39 | UPI | **₹4,148.00** | **UTR926521440871** | RB-2209-02 | **RCPT-9006** |

After the cash the screen said *"This paid INV/9007 ₹6,000.00 — INV/9007 is still open — ₹4,148.00"* and the
shop's due fell to ₹39,991.00. After the UPI: *"This paid INV/9007 ₹4,148.00"*, due **₹35,843.00**, "6 bills
still open". The UPI mode demanded its UTR by name ("A UPI payment needs its UTR").

`allocations`: RCPT-9005 → INV/9007 ₹6,000.00, RCPT-9006 → INV/9007 ₹4,148.00. `invoices.INV/9007.state =
paid`. *(Between the two, the collect screen's chip read "Settled 1 bill" over a part payment — DOS-187.)*

### Hop check 5 → the shop's own app

`ramesh.gupta` in the retailer app, on Tarsun's side of a three-distributor account:

> YOUR SHOP Shree Ganesh Kirana · PAST ITS DATE **₹35,843.00** · BILLS STILL OPEN **6** · LAST BILL
> **INV/9007 · 21 Sep** · Last payment: **₹4,148.00 · 21 Sep, 9:22 am** · Order SO-0879 · Placed 21 Sep 2026 ·
> **₹10,148.00** · Delivered

The order screen gave the shop the whole day back: *With the distributor 8:45 am → Accepted 8:51 am → Being
packed 8:56 am → Packed 8:58 am → On the way 9:14 am → **Delivered 9:20 am***, its own note, and both lines at
the rep's prices. The bill screen showed all 19 lot lines, *Goods ₹8,190.11 · CGST ₹770.04 · SGST ₹770.04 ·
Cess ₹417.99 · Rounding −₹0.18 · **Bill total ₹10,148.00*** · **Paid in full · ₹0.00**, and proof of delivery
("Signed for by Ganesh Kirana - Ramesh"). The receipts screen listed both: **RCPT-9006 UPI ₹4,148.00 · 21 Sep,
9:22 am** and **RCPT-9005 cash ₹6,000.00 · 21 Sep, 9:21 am**.

**The same rupees, everywhere.** ₹10,148.00 billed, ₹6,000 + ₹4,148 received, ₹35,843.00 still owed — the
driver's phone and the shop's phone agree to the paisa. **Yes.**

The shop is also never shown the five free bottles it was entitled to (DOS-185); it cannot miss what it was
never told about, which is the point.

---

## Hop 6 — the desk closes the day

**The crew hands over.** D8, end of day: *CASH TAKEN ₹6,000.00 · UPI TAKEN ₹4,148.00 · CHEQUES TAKEN ₹0.00 ·
SPENT ₹0.00*, and the arithmetic written out — *"Float ₹2,000.00 + cash taken ₹6,000.00 − spent ₹0.00"* →
**"Hand ₹8,000.00 to the cashier"**, with the boundary stated: *"The cashier counts the money and the godown
counts the van. **The trip closes at the office, not here.**"* Odometer 48237, checked in → `state = closing`,
`ended_at 09:25:03`.

**The desk settles.** `meena.joshi` (accountant) → Money → Day-end. "Trips coming back: **TRIP-0001 ·
MH-05-CD-5678 · Ganesh More · 1/1 · Closing**", and the settlement panel:

> Collected on the road **₹6,000.00** · Expenses ₹0.00 · **Expected ₹8,000.00** · Tolerance ₹100.00

**The desk's expected cash equals float + what the phone said.** ₹2,000 + ₹6,000 = ₹8,000, the same figure the
driver was shown at the door. She entered ₹8,000 and settled. `trip_settlements`: `expected_cash_paise
800000`, `handed_over_cash_paise 800000`, **`cash_variance_paise 0`**, `upi_collected_paise 414800`,
`has_variance false`, `settled_by` = Meena Joshi, `settled_at 09:33:46`. "Trips coming back" fell to 0 and
"Cash to bank" rose by exactly ₹6,000 (₹40,96,329.52 → ₹41,02,329.52) — the cash became bankable only once the
trip was settled.

**The accountant banks it.** RCPT-9005 appeared at the top of "Cash and cheques in hand" (*Shree Ganesh Kirana
· Cash · 6,000.00 · 21 Sep · To bank: No*), she ticked it — "1 receipts · ₹6,000.00" — and banked the batch
under slip **SLIP-QA-210926-01**. `receipts.RCPT-9005.status = deposited`, `deposited_at 09:34:55`,
`deposit_ref SLIP-QA-210926-01`. The UPI receipt correctly stayed `collected`: it is not cash in a tin.

### Hop check 6 → the owner's app, against SQL

`sunil.tarsun`, Today:

| The owner's screen | SQL | |
|---|---|---|
| **INVOICED TODAY ₹10,148.00** | `select count(*), sum(total_paise) from invoices where tenant_id=… and invoice_date='2026-09-21' and state<>'cancelled'` → **1, 1014800** | ✅ |
| **COLLECTED TODAY ₹10,148.00** | `select mode, sum(amount_paise) from receipts where … (received_at at time zone 'Asia/Kolkata')::date='2026-09-21'` → **cash 600000, upi 414800** | ✅ |
| ORDERS TODAY 1 · 1 stops delivered | SO-0879, one delivered stop | ✅ |
| Shop drawer: **Outstanding ₹35,843.00 · Overdue ₹35,843.00 · Open bills 6** | `retailer_outstanding_summary` → `outstanding_paise 3584300`, `overdue_paise 3584300`, `open_bills 6`, `oldest_due_date 2026-08-06` | ✅ |
| Shop drawer: Credit limit ₹50,000.00 · Credit days 7 | `retailers` → `5000000`, `7`, `strict` — **unchanged by the approval** | ✅ |
| Shop drawer: **"Last order 12 Sep, 12:00 pm"** | `sales_orders` latest for this shop = **SO-0879, 2026-09-21 08:45** | ❌ **DOS-189** |
| Stock → **Stock ledger**: no row from today, rows in no date order | `stock_ledger` holds **19 rows, reason `sale`, ref `pack`, −134 pc, 08:58:33 today**; the API with `from=2026-09-21` returns exactly those 19 | ❌ **DOS-186** |
| Stock → Balances (lot B20260909) | `stock_balances` on hand 336, `updated_at 08:58:33` | ✅ |

The money is right on the owner's screen to the paisa. **The stock movement for those lots is not reachable
from the owner's app**: `GET /owner/inventory/ledger?limit=200` — the call the screen makes — returns 200 rows
whose newest is **12 Sep**, because the list is ordered by `id desc` and 4 909 of the tenant's 4 964 ledger
rows carry seeded ids that sort above every real UUIDv7. That is hop 6's one failure.

---

## Hop 7 — the platform console sees counts, not money

`dos.admin` (Rohit Nair, Super) on :5279. The platform page says what it is under its own KPIs: *"Counts only.
**Not one rupee of a distributor's own trade is readable from this console.**"* Opening **M/s. Tarsun
Enterprise**:

| The console | SQL | |
|---|---|---|
| SHOPS **61** | `select count(*) from retailers where tenant_id=…` → **61** | ✅ |
| ORDERS, 30 DAYS **218** | `sales_orders` last 30 days → **218** | ✅ |
| BILLS, 30 DAYS **217** | `invoices` last 30 days → **217** | ✅ |
| STAFF LOGINS **21** | 23 active memberships − 2 `retailer` memberships = **21** | ✅ |
| FILES STORED 83 kB | — | — |
| Last seen **21 Sep 2026, 8:45 am** | SO-0879's submit | ✅ |

**Every rupee figure on the page, extracted from the DOM by regex: `["₹4,999.00"]`** — one figure, and it is
the *subscription Tarsun pays Distribution OS* (Pilot plan, monthly, 25 seats, period 13 Sep – 13 Oct). Not
₹10,148.00, not ₹35,843.00, not ₹44,24,374.00. The console also shows the support window as a bounded,
audited grant — *"A window is open until 12 Oct 2026, 12:40 pm, read only … Their service answered as their
owner. Every call is in the audit trail."* with "Nothing read yet under this window". **The wall holds.**

---

## What this chain cost the business

Nothing was lost, duplicated or delayed between people. Two things were **silently different**, and one of
them is money:

- **DOS-185 (P1)** — the shop is enrolled in a free-goods scheme, the engine priced five free bottles into the
  order, and no hand in the chain carried them: not the cart, not the reservation, not the pick sheet, not the
  invoice PDF, not the driver's drop list, not the shop's own app. The brand claim behind it has no delivered
  quantity. Every screen looked correct while it happened.
- **DOS-186 (P1)** — the owner can see today's revenue and today's outstanding, but not today's stock
  movement. The ledger screen shows 200 rows, none from this week, in no date order.

The other four (DOS-187 to DOS-190) are wording and freshness: a part payment called "settled", a hold whose
reason changes between the manager's desk and the owner's, a "last order" a day stale under "Updated just
now", and a driver's home screen that shows the wrong trip for one render.

Not exercised in this chain, and therefore neither passed nor failed: iOS (see CLAUDE.md — `expo run:ios`
cannot be driven here); Android (the whole chain ran in Chromium at both widths); a cheque; a van sale; a
second distributor; the split-platform variant of Phase 2 (sales on Android → manager on web → …); and
everything under the next heading.

---

## The days that go wrong

Eight days that do not go to plan, each walked by the people who would live it, in their own apps, on the same
stage as the first half — worktree `.claude/worktrees/b2-chain`, database `dos_test_chain`, the all-in-one with
its worker in-process on **:3200**, Playwright over headless Chromium at **1280×800** for the desk roles and
**390×844** for the field ones. The machine had **34 MB of RAM free and 7.8 of 9.2 GB of swap in use** when this
half started, so the headroom rule of the first half applied again: **one Expo web server at a time**, started,
walked and stopped — fourteen app sessions in all. Evidence is `QA/evidence/chain/wrong-*.png` (+ `.txt`, the
DOM text each screenshot was read from).

**Seven fresh orders were booked for this half**, all by `rahul.deshmukh` in the sales app, from his own beat
list, one shop at a time:

| | Order | Shop | For | Placed as |
|---|---|---|---|---|
| A | SO-0880 | Mahalaxmi General Stores (R-0003) | rejection | **held** — "Will be held for credit — 40 days overdue" |
| B | SO-0882 | Om Sai Provision Store (R-0002) | cancel mid-pick | confirmed |
| C | SO-0883 | Sai Krupa Super Bazar (R-0004) | partial delivery | confirmed |
| D | SO-0881 | Ganesh General Store (R-0007) | failed delivery | confirmed |
| E | SO-0884 | Balaji Wholesale Stores (R-0010) | reassignment | confirmed |
| F | SO-0885 | Sai Baba Kirana (R-0011) | return after delivery | confirmed |
| G | SO-0886 | Laxmi Narayan Stores (R-0013) | refusal at the door | confirmed |

They were picked as two waves (PICK-0080, PICK-0081) and packed by `dinesh.patil`, becoming **INV/9008–INV/9012**;
loaded onto **TRIP-0002** (Ganesh More, MH-05-CD-5678, four stops, DC-0084) and **TRIP-0003** (Mahesh Sutar,
MH-05-AB-1234, one stop, DC-0085), each approved by `vikas.kadam` from the manager's Load-out board and counted
out at the godown.

---

### 1 — The order the manager rejects

**The hold.** SO-0880 reached the desk with **two** gates, not one: `approval_flags = ["credit_limit","bargain"]`.
The second is real — a `bargain_requests` row for this shop and this very item (Campa Cola 750 ml) had been sitting
`requested` since 12 Sep, and the submit attached it. The manager's drawer stated both, and stated the holding:

> Order SO-0880 · Mahalaxmi General Stores · Credit: Owes ₹36,259.00 · limit ₹50,000.00 · **Waiting on: Over
> credit limit / Bargain** · Lines Campa Cola 750 ml 1 cs · 24 pc · **1 pc free** · Free goods ₹617.43 ·
> **Held for this order 0 pc across 0 lots** · Confirm order — *"Waiting on Over credit limit · Bargain. Approve
> or reject each one first; the last approval confirms the order."*

**Nothing was reserved** while it waited: `select count(*) … reservations … where order = SO-0880` → **0**, and the
drawer says so in words. Correct.

**The rejection.** `vikas.kadam` pressed Reject on the credit gate. The dialog demanded a note — *"Write a note
first — the person who asked will read it"* — and he typed *"Rejected: 40 days overdue and no payment promised.
Collect the old bills first."* One press, and:

```
sales_orders  → state = cancelled, cancel_reason = 'approval_rejected', cancelled_at 10:08:28
approvals     → credit_limit: rejected, by vikas.kadam, note stored in full
              → bargain:      expired,  decision_note 'approval_rejected'
reservations  → 0
outbox_events → OrderCancelled, published by the worker at 10:09:13
```

One gate rejected kills the order and expires the other. Nothing was held, so nothing had to be released.

#### What the rep got

Three things went wrong on the way back to the man standing in the shop.

- **He was not told.** The submit had pushed `order_needs_approval` to `vikas.kadam` *and* `sunil.tarsun`. The
  decision pushed **nothing to `rahul.deshmukh`** — `messages` for that minute holds exactly one row, a WhatsApp
  to the *shop*. His "Needs you" screen reads *"Refused: 0 · Nothing has been refused"*, because that screen means
  writes the server bounced, not orders the office refused.
- **The order is not in his default list.** S6 opens on **Travelling**, which filters to submitted/confirmed/
  picking/packed/dispatched. SO-0880 appears only under **All**, one tap away, as *Cancelled*.
- **He is shown the machine's word, not his manager's.** The order screen says:

  > SO-0880 · **Cancelled** · This order was cancelled · **Reason given: `approval_rejected`** · Cancelled
  > 21 Sep, 10:08 am · Waiting for the office: Credit limit — **Refused**; Rate change — **Expired**

  The manager's sentence is in `approvals.decision_note` and is on no screen the rep can reach. Compare the
  desk's *cancel* path in §2, where the typed reason travels intact — the same field, `cancel_reason`, carries a
  human sentence there and the literal string `approval_rejected` here.

**The shop** got *"Your order SO-0880 of ₹617.00 has been cancelled. Call us if this is a mistake."* — no reason,
and an invitation to ring about a decision the office took deliberately.

> **DOS-191 · business-logic · P1** — an order refused at a gate tells the rep `approval_rejected` and loses the
> manager's note; nobody is notified at all.
> Evidence `wrong-1-reject-b-drawer.png`, `wrong-1-reject-c-dialog.png`, `wrong-1-rep-d-order.png`,
> `wrong-1-rep-a-attention.png`.

---

### 2 — The order the desk cancels while it is being picked

`dinesh.patil` built **PICK-0080** for SO-0882 alone (2 lines, 44 pc), started it, and picked the first line —
Campa Orange 2 L, 24 pc, lot B20260729. **One of two lines in the trolley**, the sheet live.

The desk then cancelled. Two notes about getting there: the manager's order queue opens filtered to **Submitted**,
so a picking order is not in it until you tick "Being picked"; once opened, the drawer read *"Held for this order
**44 pc across 2 lots**"*. The dialog is the best sentence in the app:

> Cancel order · SO-0882 · ₹3,849.00 · **"The picker will be told which lines to put back."** ·
> *Why is it cancelled? **The shop and the rep will read this.***

**The picker was told, by lot.** Reopening PICK-0080 on the phone:

> **PICK-0080 · cancelled · Put back**
> Konkan Bhajani Chivda 400 g — *Not needed — the order was cancelled*
> Campa Orange 2 L — **Put back 24 pcs · B20260729**

The line he had already lifted names the lot it goes back on; the line he had not is marked as never needed. That
is the hand-off working.

**The database agrees.** `reservations` → both rows `voided` 10:31:14; `stock_balances.reserved` → 0 on both lots;
`pick_lines.cancelled_at` set on both, `picklists.status = cancelled`; `sales_orders.cancel_reason` = the
manager's own sentence; **no invoice exists for R-0002 today**. Stock never left the Godown, because relief
happens at pack — so "stock returns to the right lot" is, correctly, a trolley instruction and not a ledger entry.

**The rep read the reason**: S6 → SO-0882 → *"This order was cancelled · Reason given: Shop rang: shutter closed
for a family function, do not send today."* The dialog's promise to the rep is kept.

**The shop's half of that promise is not.** The only thing R-0002 was sent is the template
*"Your order SO-0882 of ₹3,849.00 has been cancelled. Call us if this is a mistake."* The typed reason is not in
it, so the dialog's "the shop … will read this" is false.

> **DOS-192 · ux · P2** — the cancel dialog promises the shop will read the reason; the shop's message is the
> generic template and the reason is dropped. Evidence `wrong-2-cancel-f-dialog.png`, `messages` row 10:31.

Minor, recorded: the cancelled wave shows in the picker's WAVES list as *"PICK-0080 · 24 of 44 pc picked ·
cancelled"* but nothing on the queue screen says pieces are waiting to go back, and the cancelled sheet still
carries a *"Take it to packing"* footer. Evidence `wrong-2-cancel-h-pick-queue-390.png`,
`wrong-2-cancel-i-putback-390.png`.

---

### 3 — The part delivery

Sai Krupa Super Bazar, stop 1 of TRIP-0002, **INV/9008 ₹3,810.00**, two lines. Ganesh arrived; the deliver screen
opened pre-filled at full quantity. He dropped the Campa in full and cut the chivda from 20 pc to 10 through the
pieces pad, then chose the reason. **The reason is the disposition**, and the screen says which bin it picked:

> Will be recorded as **Part delivered** · 10 pc short · … Konkan Bhajani Chivda 400 g · Dropping **10 pc** ·
> **Taken back · 10 pc** · Shop refused it / **Damaged** / Past its date → **"Into the damaged / expiry bin"** ·
> *This shop is on credit — a photo is required before you can record it* · **Dropping 34 / 44 · ₹3,810.00**

Photo attached, receiver typed, note typed, recorded.

**The credit note raised itself, at the door, in the same write:**

```
deliveries     → outcome = partial, 10:44:35, receiver 'Sai Krupa - Vijay'
delivery_lines → 24 / 0 returned;   10 delivered / 10 returned, saleable = FALSE, reason = 'damaged'
credit_notes   → CN/9003, return_damaged, ISSUED, ₹1,066.00, note = the driver's own sentence,
                 pdf_object_key filled by the worker
stock_ledger   → sale_return_damaged +10  →  Damaged / expiry bin, lot B20260729, ref_type credit_note
```

**The shop's outstanding is the delivered amount, not the billed one.** R-0004 went **₹2,10,519.00 → ₹2,09,453.00**,
exactly ₹1,066 less, and INV/9008 now reads `partially_paid` with ₹1,066 credited against ₹3,810 — net **₹2,744.00**
due. The driver's own stop screen showed the new figure before he left the counter. **This one is clean.**

Two things to record.

- The footer counts pieces honestly and money dishonestly: **"Dropping 34 / 44 · ₹3,810.00"** — the full bill,
  beside a short count. The screen has the rate and the shortfall; it could say ₹2,744.
- The shop's WhatsApp names the bill by a **UUID fragment**: *"Your goods against bill **6A91E205** were partly
  delivered (10 pcs short) today"* — and the same template for the full delivery in §6: *"Goods against bill
  **67EB3FA1** delivered today."* The shop has INV/9008 and INV/9011 on paper and cannot match either.

> **DOS-193 · bug · P2** — the `pod_delivered` message names the invoice by the first eight hex of its id instead
> of its number. Evidence: `messages` 10:45 and 10:50 rows, quoted above.
> **DOS-194 · ux · P3** — the deliver footer shows the full bill value beside a short count.
> Evidence `wrong-3-partial-e-before-record.png`.

---

### 4 — The delivery that fails

Ganesh General Store, stop 2, **INV/9009 ₹614.00**. The fail sheet states the consequence before the reason list:

> **Why was nothing delivered?** — *"Every bill on this stop goes back to the office as undelivered and the goods
> stay on the van."* — Shop was shut · Shop refused it · Shop had no money · Wrong address · Goods were damaged ·
> Something else

Reason *Shop was shut*, note *"Shutter down at 11, neighbour says back after 4."* Written: `trip_stops` →
`state = failed, failure_reason = shop_closed`, the note stored; `deliveries` → `outcome = failed`; **no credit
note, no stock row, no receipt.**

**The bill did go back to planning, exactly as promised.** On the manager's *Plan a trip* panel the bill is listed
under the packed ones but **disabled and labelled**:

> Ganesh General Store — **"Out on TRIP-0002 — back after check-in"** — ₹614.00

and the same for Laxmi Narayan Stores from §8. It is not offered to a second van, and the rule is the server's
(`ridingTrips`), not the screen's. **The shop sees nothing delivered**: R-0007's order stays `packed`, no POD, no
delivery message.

Three failures of the hand-off, and the first is the serious one.

**(a) The goods are nowhere.** The load-out dialog says *"Stock moves to the vehicle"*, and the godown's own
**Van check-in** screen is built on that ("The crew's unsold cases and the goods a shop refused are still standing
on the vehicle's own stock location" — `check-in.tsx`). Opened for MH-05-CD-5678, with four cartons counted out on
DC-0084 that morning and 75 pieces riding back undelivered, it says:

> **EXPECTED ON THE VEHICLE — "Nothing is loaded on this vehicle"** — 0 lot rows.

The driver's end-of-day screen says the same from the other side: *"Still on the van — The godown counts this back
in when you check in — **Nothing here yet**"*, 0 rows. And SQL agrees: `stock_balances` for
`Vehicle MH-05-CD-5678` → **0 rows, 0 pieces**, while `stock_ledger` for today holds 26 `sale −qty` rows out of the
Godown at pack and not one vehicle row. Of the 163 pieces packed for this half, 72 stayed with shops, 16 went to
the damaged bin, and **75 are physically on a van and in no location in the database.** Nothing can count them back
in; the distributor's stock on hand is 75 pieces light until someone notices.

> **DOS-195 · business-logic · P1** — pack relieves the Godown with no counterpart on the vehicle, so undelivered
> and refused goods vanish from inventory and the van check-in built to count them back has nothing to show.
> Evidence `wrong-4-failed-f-checkin-cd.png`, `wrong-5-reassign-h-day.png`, the balances query above.
> (This is the ledger half of S-172 from the first half, which only noted that no transfer rows are written.)

**(b) The desk cannot tell a failed bill from a delivered one.** `vikas.kadam` opened INV/9009 in Billing:

> Bill INV/9009 · Ganesh General Store · **Payment Issued · Total ₹614.00 · Still due ₹614.00** · Print the bill ·
> Record the e-way bill · Get the IRN · Cancel the bill

Identical, word for word, to the refused INV/9012 and to any delivered bill. Nothing says *not delivered*,
*refused*, or *on a van*. The Today tile says **"3 trips active"** and Fulfilment → Trips lists only
`planned` and `loading` (`trips.list({states:['planned','loading']})`), so the desk is told three vans are out and
given no screen that opens one.

> **DOS-196 · missing-feature · P1** — no desk screen shows what came back undelivered; the bill panel of a
> refused bill is indistinguishable from a paid one, and the desk cannot open an active trip at all.
> Evidence `wrong-4-failed-d-desk-bill.png`, `wrong-8-refused-d-desk-bill.png`, `wrong-desk-a-today.png`,
> `wrong-5-reassign-a-board.png`.

**(c) The shop is chased for goods it never got.** R-0007 was sent, at 10:22, *"Namaste! Bill INV/9009 of ₹614.00
is ready — pay by 2026-10-05 to keep your 2% cash discount"*, and at 10:37 *"Our vehicle is on its way … (stop 2).
Please keep the payment ready."* After the stop failed at 10:46: **nothing**. Same for R-0013 (§8) and R-0010
(§5). The bill stays in the shop's own app under *Still to pay*, and in `retailer_outstanding_summary`.

> **DOS-197 · business-logic · P1** — a failed or refused delivery sends the shop no message and leaves the bill
> payable and ageing; the shop is dunned for goods sitting on the distributor's van.
> Evidence `wrong-5-shop-c-bills.png`, `wrong-5-shop-e-inbox.png`, the `messages` sweep.

---

### 5 — The delivery reassigned mid-route

The question was whether a bill on one crew's van can be moved to another crew's while both are out. **It cannot,
and no app offers it.**

- **The desk cannot see the trip.** M7 Trips lists `planned` and `loading` only; TRIP-0002 and TRIP-0003 were
  `active` and absent from the register. `trip-add-<TRIP-0003>` control present: **0**.
- **The godown can see it and still cannot.** W10 lists active trips — TRIP-0003 *active*, TRIP-0002 *active* —
  but renders **"Add a bill" only for `planned` or `loading`** trips. `w10-add-<TRIP-0003>` present: **0**. The
  only Add-a-bill on the screen belonged to the seeded TRIP-NEXT.
- **The bill itself is held.** While TRIP-0002 was active, INV/9010 appeared in neither the selectable nor the
  held list of the plan panel: a bill still *planned* on a running trip is simply invisible to planning. The two
  bills the crew had already failed showed as **"Out on TRIP-0002 — back after check-in"**, disabled.
- **The crew cannot be changed either.** There is no procedure to change a trip's driver: `delivery.trips` has
  create / start-loading / depart / return / cancel / settle and nothing that edits the crew.

So the only path the product allows is the long one, and it was walked to the end. Ganesh recorded stop 3 as
failed — reason *Something else*, note *"Office says put this drop on Mahesh van, my vehicle is going the other
way."* — and checked the vehicle in:

> Check the vehicle in — *"Stops you have not finished are recorded as not delivered and their bills go back to
> the office. The goods stay on the van until the godown counts them."* → TRIP-0002 `closing`, ended 11:04:27.

The moment the van was at the dock, all three bills appeared as ordinary selectable rows on the desk's plan panel
(INV/9009, **INV/9010**, INV/9012), and `vikas.kadam` planned **TRIP-0004 · MH-05-EF-9012 · Raju Yadav · 1 stop ·
₹605.00**.

**The bill rides one trip only, and the two drivers' lists prove it.** `raju.yadav` → *Your trips*: **TRIP-0004 ·
21 Sep 2026 · MH-05-EF-9012 · 0 of 1 done · Planned**. `ganesh.more` → *Your trips*: TRIP-0002 (*Checked in*),
TRIP-0001 (*Closed*), TRIP-NEXT, TRIP-ACTIVE — **no TRIP-0004**. `mahesh.sutar` never saw Balaji at any point.
`trip_stops` holds one `pending` row for R-0010, on TRIP-0004, and one `failed` row on TRIP-0002.

What the new driver did **not** get is the front screen: his home still reads *"TRIP-ACTIVE · **12 Sep 2026** ·
Today's trip · On the road"* — a nine-day-old seeded trip he is the helper on — because home shows the active
trip and TRIP-0004 is merely planned. Today's reassigned drop is one tap away under *Your trips*, not on the
screen he opens.

> **DOS-198 · missing-feature · P2** — a bill cannot be moved between crews while the van is out: the desk cannot
> open an active trip, the godown's Add-a-bill is withheld from active trips, and no procedure changes a trip's
> driver. The only route is to fail the stop, check the whole van in, and replan.
> Evidence `wrong-5-reassign-a-board.png`, `wrong-5-reassign-e-godown-trips.png`, `wrong-5-reassign-d-plan-held.png`,
> `wrong-5-reassign-j-freed.png`, `wrong-5-reassign-k-raju-trips.png`, `wrong-5-reassign-l-ganesh-trips.png`.

---

### 6 — The return booked at the desk

Sai Baba Kirana took **INV/9011 ₹3,849.00** in full from Mahesh at 10:49 (44 / 44, photo, receiver *"Sai Baba -
Anil"*). The shop then sent six burst packets back, and `vikas.kadam` booked it in Billing → Credit notes →
*Draft a credit note*: search INV/9011, reason **Return, damaged**, 6 pc against the chivda line. The draft
appeared with no number; issuing it gave:

> Issue the note · ₹646.00 · *"The number is allotted, **the pieces go back into stock** and the shop is credited."*

```
credit_notes   → CN/9004, return_damaged, issued 10:58:37, ₹646.00, note = '' (empty)
stock_ledger   → sale_return_damaged +6 → Damaged / expiry bin, lot B20260729, ref_type credit_note
invoices       → INV/9011 partially_paid, ₹646 credited of ₹3,849
retailer_outstanding_summary(R-0011) → ₹1,47,779.00 → ₹1,47,133.00
```

**Damaged goods never become sellable again — measured, not assumed.** Both of today's returns (the driver's
10 pc and the desk's 6 pc) are `+qty` rows into the **Damaged / expiry bin**, which now holds 16 pieces of lot
B20260729. The Godown's own balance for that lot was never credited: grouping the ATP view by location gives
**Godown 166 available · Damaged / expiry bin 16 available**, two separate rows, and every caller of the view
scopes to one location — `availability` and `availablePcs` to the reservable godown id, `fefoLots` to the pick
location, `stock.sellable` to `l.kind = 'warehouse'` (or `('warehouse','vehicle')` when a location is named). So
no order, reservation or pick sheet can reach those 16 pieces. The contract enforces the rule from the other end
too: `return_damaged` with `saleable: true` is a 400. **The shop's outstanding dropped by exactly the credit.**
This one is clean.

The safety is in the call sites, not in the object: the view is **named `sellable_stock` and contains the damaged
bin** — `select count(*), sum(available) from sellable_stock join locations … where kind='damaged'` → **85 rows,
1 241 pieces**, `available` and all. Six call sites currently filter it; a seventh that forgets sells expired and
broken stock, and the name will not warn its author.

> **DOS-204 · tech-debt · P2** — `sellable_stock` includes the damaged / expiry bin (85 rows, 1 241 pieces) and
> every consumer must remember a location filter. Evidence: `pg_get_viewdef('sellable_stock')` (no location
> predicate) and the two queries above.

Two things the desk did not get.

- **The dialog says the wrong thing on the one reason where it matters.** *"the pieces go back into stock"* is
  printed for `return_damaged` as well as for `return_saleable`, when the whole point of the reason the manager
  just chose is that they do **not**.
- **A desk return carries no words.** There is a note field on *cancel* and none on *draft* or *issue*, so
  `credit_notes.note` for CN/9004 is empty. CN/9003, raised by the driver, carries his sentence. Six months later
  the desk-booked ₹646 has a code and no story.

> **DOS-199 · ux · P2** — the issue dialog promises "the pieces go back into stock" for a damaged return that goes
> to the damaged bin. Evidence `wrong-6-return-h-draft-panel.png` and the dialog text quoted above.
> **DOS-200 · missing-feature · P2** — a credit note drafted or issued at the desk has nowhere to record why.
> Evidence `credit_notes.note` = '' for CN/9004 against the driver's populated CN/9003.

Recorded in passing: the credit-note register is in **no date order** — 25 Aug, 12 Aug, 9 Sep, 14 Aug … and the
note drafted seconds earlier sat **55th of 56 rows**, below notes from 25 Aug, 12 Aug and 14 Aug, which is the
founder's own list-order rule of 2026-09-20 broken on this screen. Evidence `wrong-6-return-g-register.txt`
(54 `CN/0…` rows precede it).

> **DOS-201 · ux · P2** — the credit-note register is unordered and a note just created is not findable near the top.

---

### 7 — The part payment

Shivshakti Traders (R-0006) owed **₹22,834.00** over five open bills, the oldest INV/0228 due **16 Jul**. The
accountant `meena.joshi` took ₹10,000 cash at the counter: manager app → Money → *Record a payment*, shop
"Shivshakti", **Cash**, ₹10,000, reference typed. The form states the shop's total before the money is taken —
*Owes ₹22,834.00* — and its rule underneath:

> **"Oldest bill first unless you say otherwise."**

**RCPT-9007 · cash · ₹10,000.00 · collected**, and the allocation is exactly FIFO:

| Bill | Due | Before | Allocated | After |
|---|---|---|---|---|
| INV/0228 | 16 Jul | ₹7,664.00 | **₹7,664.00** | **paid** |
| INV/0273 | 20 Jul | ₹6,203.00 | **₹2,336.00** | ₹3,867.00 · partially_paid |
| INV/0371 | 30 Jul | ₹3,145.00 | — | ₹3,145.00 |
| INV/0410 | 3 Aug | ₹4,931.00 | — | ₹4,931.00 |
| INV/0725 | 7 Sep | ₹891.00 | — | ₹891.00 |

**The remainder ages correctly.** `retailer_outstanding_summary` moved ₹22,834 → **₹12,834.00**, open bills 5 → 4,
`oldest_due_date` **2026-07-16 → 2026-07-20**, `overdue_paise` = the whole remaining ₹12,834 — right, because every
surviving bill is past its date. The shop was told: *"Received ₹10,000.00, receipt RCPT-9007. Thank you!"*

**The one thing the desk did not get is the sentence's second half.** There is no way to say otherwise. The screen
offers shop, mode, amount and reference and nothing else; the receipt detail lists allocations read-only; and
`allocations.create` / `allocations.remove` — which exist in the contract and in the permission matrix — are
called by **no screen in any of the seven apps** (`grep -rn "allocations.create\|allocations.remove" frontend/`
→ nothing). A shop that pays ₹10,000 "against the Ganpati bill" has it put on a July bill, and the desk cannot
move it. The driver *can* tag a collection to a bill at the door; the office cannot.

> **DOS-202 · missing-feature · P2** — the desk cannot allocate a receipt to a chosen bill, though the screen
> promises it can ("unless you say otherwise") and the API supports it.
> Evidence `wrong-7-payment-c-form.png` (line 2044 of its `.txt`), the grep above.

---

### 8 — The shop that refuses the goods at the door

Laxmi Narayan Stores, stop 4, **INV/9012 ₹614.00**, one line of 25 pc (24 billed + 1 free). Ganesh arrived,
opened Deliver and pressed **"Nothing from this bill"**:

> Will be recorded as **Not delivered** · 25 pc short · … **Taken back · 25 pc** · **Shop refused it** / Damaged /
> Past its date → **"Can be sold again"** · *A photo is not required here, but it settles arguments later* ·
> **Dropping 0 / 25**

Photo attached anyway, receiver and note typed (*"Owner says he never ordered soft drink this week; refused the
whole bill at the door."*), recorded.

**The outcome, line by line.** `trip_stops` → `state = failed`; `deliveries` → `outcome = failed`, the note stored;
`delivery_lines` → 0 delivered, **25 returned, `returned_saleable = TRUE`, `reason = 'refused'`**. So the stock
decision is right in the row: these are good goods, they come back to sell. **No credit note** was raised —
correct, since a refused bill is meant to be cancelled or redelivered, not credited.

Four gaps, three of them already named above:

- **The stop has no reason.** A refusal taken through the deliver screen leaves `trip_stops.failure_reason` and
  `failure_note` **NULL**, while the two stops failed through the fail sheet carry `shop_closed` and `other`. The
  word *refused* exists only on the delivery line. Any desk register that reads the stop sees a failure with no
  cause.
- **The goods are nowhere** — 25 saleable pieces, `returned_saleable = true`, and no location holds them
  (**DOS-195**).
- **The desk cannot tell** (**DOS-196**): INV/9012's panel is identical to a delivered bill's.
- **The shop still owes ₹614.00** for goods it refused at its own counter (**DOS-197**). R-0013's outstanding is
  unchanged at ₹1,38,500.00, the bill is `issued`, due 5 Oct, and the shop had already been sent its UPI link at
  10:22.

**What the desk does next, measured, not assumed:** the only move available is Billing → INV/9012 → **Cancel the
bill** — `billing.invoices.cancel` is `PIN_HOLDERS`, owner and manager, so the accountant does not get the
button — or wait for the van to check in and replan it. The
bill returned to the plan panel as *"Out on TRIP-0002 — back after check-in"* and became selectable the moment
Ganesh checked in — so redelivery works; **nothing automatically un-bills the shop, and nothing tells it.**

> **DOS-203 · bug · P2** — a refusal recorded on the deliver screen leaves the stop's `failure_reason` empty, so
> the stop and every register over it say "failed" with no cause. Evidence: `trip_stops` rows for TRIP-0002
> (sequence 4 vs 2 and 3), `wrong-8-refused-b-nothing.png`.

---

## What the next person did not get

Every hand-off in both halves of this phase where something was **lost, delayed, duplicated or silently
different**. The first half's five are kept so the list is whole.

| # | From → to | What did not arrive | Where |
|---|---|---|---|
| 1 | Pricing engine → everyone | Five free bottles priced into SO-0879 and carried by no hand: not the cart, the reservation, the pick sheet, the invoice PDF, the drop list or the shop's app. **DOS-185 (P1)** | half 1, hops 1–5 |
| 2 | Pack → the owner's stock screen | Today's 19 ledger rows unreachable: the list is ordered by `id desc` and 4 909 seeded ids sort above every real UUIDv7. **DOS-186 (P1)** | half 1, hop 6 |
| 3 | Collection → the driver's chip | A ₹6,000 part payment on a ₹10,148 bill announced as "Settled 1 bill". **DOS-187** | half 1, hop 5 |
| 4 | Sales → manager | The hold's real reason (46 days overdue) becomes "This order takes it ₹0.00 over the limit" on the manager's drawer; the owner's screen states it correctly. **DOS-188** | half 1, hop 1 |
| 5 | Order → the owner's shop drawer | "Last order 12 Sep" under "Updated just now", nine days after SO-0879. **DOS-189** | half 1, hop 6 |
| 6 | Depart → the driver's home | The wrong trip for one render; a reload fixes it. **DOS-190** | half 1, hop 4 |
| 7 | **Manager's rejection → the rep** | The note is stored and shown to nobody; the rep reads `approval_rejected`, is not notified at all, and the order is off his default list. **DOS-191 (P1)** | §1 |
| 8 | **Desk's cancel → the shop** | The dialog promises the shop will read the reason; the shop gets the generic template. **DOS-192** | §2 |
| 9 | **Door → the shop's phone** | The POD message names the bill `6A91E205` instead of INV/9008. **DOS-193** | §3, §6 |
| 10 | **Bill → the driver's footer** | "Dropping 34 / 44 · ₹3,810.00" — piece count short, money full. **DOS-194** | §3 |
| 11 | **Pack → the vehicle → the godown** | 75 pieces relieved from the Godown, loaded, refused and carried back, and no location holds them; the van check-in reads "Nothing is loaded on this vehicle". **DOS-195 (P1)** | §4, §5, §8 |
| 12 | **Van → the desk** | No screen shows what came back undelivered; a refused bill's panel is a delivered bill's panel; an active trip cannot be opened at all, while Today says "3 trips active". **DOS-196 (P1)** | §4, §5, §8 |
| 13 | **Failed / refused delivery → the shop** | No message, the bill stays payable and ageing, and the shop is dunned for goods on the distributor's van. **DOS-197 (P1)** | §4, §5, §8 |
| 14 | **Crew → crew** | A bill cannot move between vans while they are out; no screen and no procedure. **DOS-198** | §5 |
| 15 | **Desk → the damaged bin** | "The pieces go back into stock" printed over a damaged return that goes to the damaged bin. **DOS-199** | §6 |
| 16 | **Desk → the record** | A credit note drafted or issued at the desk has nowhere to say why; `note` is empty. **DOS-200** | §6 |
| 17 | **New note → the register** | Unordered register; a note created seconds ago is 646 lines down. **DOS-201** | §6 |
| 18 | **Shop's instruction → the allocation** | "Oldest bill first unless you say otherwise" — and no app can say otherwise, though the API can. **DOS-202** | §7 |
| 19 | **Refusal → the stop** | `failure_reason` left empty when the refusal is recorded on the deliver screen. **DOS-203** | §8 |

**What went right and should not be lost in the list.** The put-back instruction names the lot
(§2). The credit note for a short delivery raises itself at the door, to the paisa, and the shop's outstanding
becomes the delivered amount (§3). Damaged goods go to the damaged bin and can never be sold again, from both the
driver's hand and the desk's (§3, §6). FIFO allocation and ageing are exact (§7). The "one trip only" rule is the
server's and holds under a deliberate attempt to break it (§5). No reservation is taken for an order that is still
waiting for a decision (§1), and every reservation is voided the moment the desk cancels (§2).

**Not exercised, and therefore neither passed nor failed:** iOS and Android (browser only, per the founder's
2026-09-21 re-ordering); a cheque or a bounce; a van sale; a second distributor's side of any of this; the
retailer app for R-0004, R-0007, R-0011 and R-0013 — `retailer_links` holds only two shop logins in this database
(`ramesh.gupta` → R-0001, `fatima.shaikh` → R-0010), so the shop's own screens were walked for R-0010 only and the
others were read through `messages` and `retailer_outstanding_summary`; the money settlement of TRIP-0002 and
TRIP-0003 (both were left `closing` / `active`); and the redelivery of INV/9010 on TRIP-0004, which was planned
but not loaded or departed.

**State this half leaves behind** (for whoever picks it up): `dos_test_chain`, all-in-one on :3200 **stopped by
this run only if it started it — it was already up and is left running**; orders SO-0880–SO-0886, bills
INV/9008–INV/9012, credit notes CN/9003 and CN/9004, receipt RCPT-9007, picklists PICK-0080 (cancelled) and
PICK-0081, challans DC-0084 and DC-0085, trips TRIP-0002 (`closing`), TRIP-0003 (`active`, one delivered stop) and
TRIP-0004 (`planned`, Raju Yadav, INV/9010). No Expo server is left running.
