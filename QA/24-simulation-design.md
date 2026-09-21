# The seven-day business simulation — architect's design (Fable, 2026-09-21)

Binding for the lanes that run it on Tue 23 – Wed 24 Sep 2026 (days 2–3 of `QA/10-DAY-PLAN.md`). The
founder called this "imp" and cut everything around it so that it keeps two full days. It is the one test
in this programme that asks the product to behave like a business rather than a set of screens, and it ends
in arithmetic. Its output is `QA/25-seven-day-business-simulation.md` (Phase 21, `QA/PHASES.md`).

## 1. What it is, in one sentence

Seven trading days of one distributor, driven through the seven apps in a browser by agents playing the
people who work there, on a fresh seeded database, closed by an **independent auditor** who computes the
books from SQL without reading the operator's report — and any drift between what the apps say and what
the ledgers hold is a P0.

## 2. The stage

- **Database** `dos_test_sim`: created from `dos_test_batch2b_template`, `pnpm db:migrate`, `pnpm db:seed`.
  Snapshot **S0** taken before any action (§7). Never `dos`, never `dos_qa`.
- **Services**: the all-in-one on a free port (the port rule: if :3000–:3007 are held, use :3200; never kill
  what you did not start) plus the worker, against `dos_test_sim` only. The worker matters: settlements,
  ageing, PDFs and the outbox relay run through it, and a simulation without it is not the product.
- **Apps**: each role's Expo web build served on its own port, `EXPO_PUBLIC_API_URL` pointed at the
  all-in-one. Driven by Playwright at **1280×800**; the sales and delivery legs also at **390×844**, because
  that is where those roles live. No direct API calls except where §5 day 6 says so, and those are labelled.
- **The distributor**: Tarsun Enterprises (the pilot tenant). The two other seeded distributors stay
  untouched and are used only by the auditor's cross-tenant check (§7 e).
- **The cast** (every password `Dos@1234`; confirm the full list in `docs/18-build-log.md` before starting):
  owner `sunil.tarsun` · manager `vikas.kadam` · accountant `meena.joshi` · warehouse `dinesh.patil` ·
  delivery `ganesh.more` · sales `rahul.deshmukh` (and a second rep if the seed has one) · retailer
  `ramesh.gupta` (buys from all three distributors) and `fatima.shaikh` (two). Platform admin `dos.admin`
  appears once, on day 1, to prove the console can see the tenant's counts and never a rupee of its trade.
- **Scale, fixed so two real days can carry it**: **12 shops** (8 existing + 4 onboarded on day 1), **8 SKUs
  across at least 3 batches** each (so FEFO and per-batch arithmetic mean something), **2 vans**, **3 trips
  a day** on days 2–5, **≥ 40 orders** by the end of day 6. Every quantity is whole pieces; every rupee is
  paise.

## 3. The rule that governs every action

Each action is taken **as the person who would take it, in that person's app**. The rep books in the sales
app; the manager approves in the manager app; the warehouse picks in the warehouse app; the driver delivers
and collects in the delivery app; the shop looks at its bill in the retailer app; the owner reads the numbers
in the owner app. If a role cannot do something in its app that the business needs done, that is a finding,
not a reason to do it through the API. The operator writes down, per action, **what the next person saw**
— that hand-off is where distribution businesses lose money, and it is what Phase 2 asks at every hop.

## 4. The seven days, concretely

**Day 1 — set up the business.** Owner: confirm branding, numbering series, credit terms; set the minimum
shelf life (30 days). Onboard 4 new shops with credit limits and modes (one `warn`, one `strict`, one
`stop`, one plain). Add a second rep if the seed lacks one. Manager: post a goods receipt for 8 SKUs × 3
batches with distinct expiry dates (one batch inside 30 days, deliberately). Owner: prices per tier, one
retailer override marked `final`, two schemes (a percentage line scheme and a "bills over ₹X" order scheme,
one of them exclusive). Admin console: read Tarsun's counts; assert no rupee figure is visible.
*Hand-off check: does the rep's beat now show the 4 new shops with the right credit chips?*

**Day 2 — sell, approve, pack.** Reps book **12 orders** across the beat, including: one over a `warn`
shop's limit (goes through with the notice), one over a `strict` shop's limit (needs approval), one with a
bargain request, one from the retailer app itself, one "order again". Manager/owner approve or reject
(reject one, on record). Warehouse: pick lists consolidated by SKU, FEFO — the short-life batch must be
passed over when another batch covers the line; one line deliberately short-packed with a reason. Pack →
invoices issued at pack, own name and logo on the PDF.
*Hand-off: does every packed bill appear on the planning board with the right amount?*

**Day 3 — deliver and collect.** Plan 3 trips from the board; load sheets built, **manager approves with
PIN from the manager app**, crew count confirmed, trips depart (never past a draft sheet; the warehouse
role must be unable to depart one). Driver: deliver with proof, collect **cash, UPI with UTR, one cheque**;
one shop pays part of its bill; one stop is a van sale from vehicle stock. Check in; settle each trip; one
trip settled with a variance the owner must approve. Accountant: bank the cash and the cheque (cheque of a
settled trip only). Retailer app: `ramesh.gupta` sees the bill, the receipt, the outstanding.
*Hand-off: does the desk's expected cash equal float + what the phones say was collected, trip by trip?*

**Day 4 — the business changes.** Manager posts a second goods receipt (new batches of 3 SKUs). Owner
raises one price list and introduces a third scheme mid-day; reps book 8 more orders — some before, some
after the change — and the design's rule holds: **an order confirms at the rates in force when it was
placed; a held order confirms with rates approved since, and nothing else re-prices it**. Pack and
deliver as day 3, 2 trips.
*Hand-off: do yesterday's unfilled orders carry yesterday's prices?*

**Day 5 — the ugly day.** A partial delivery (per-line short, reason → credit note). Damaged goods at the
door (→ damaged bin, **never** saleable; the pieces must not reappear in `sellable_stock`). A failed
delivery (stock stays on the van; the bill goes back to planning, not to the shop). A return after delivery
booked at the desk. A partial payment allocated oldest-bill-first. **The day-3 cheque bounces**: reversal
plus bank charges, the bill reopens. A late cash payment for a trip already settled: **refused on the phone
and handed to the cashier** (founder answer A); the accountant records it at the desk. One desk undo of a
receipt after settlement: the reversal credits CASH, never CASH_VAN.
*Hand-off: after all of it, does each shop's outstanding in the retailer app equal what the owner's app
says it owes?*

**Day 6 — volume, concurrency, and no signal.** **20 orders** booked quickly across reps and the retailer
app. **The explicitly API-driven part**, labelled as such in the report: (a) *N* concurrent submits for one
SKU whose combined quantity exceeds ATP — exactly the available pieces are reserved, none over, no negative
balance; (b) the same upload sent twice with the same `opId` — one outcome, recorded once; (c) two desks
banking one receipt in the same second — one wins, the loser reads "is deposited, not collected".
Browser-driven: the delivery app with the network cut mid-route — collect cash offline, deliver offline,
reconnect, sync; the outbox drains once; D8 cannot check in while a payment is unsent. 3 trips, all settled.
*Hand-off: does the manager's queue show 20 orders and not 21, 19, or 20 with one duplicated?*

**Day 7 — the books.** Nobody trades. Owner: dashboard, outstanding by ageing bucket, stock by SKU and
batch, revenue, gross margin, the trial balance. Accountant: day-end registers, bank deposits, cheques,
Tally export. Manager: reports. **Every number on a screen is written down next to the SQL that should
equal it.** Then the auditor runs (§7).

## 5. What is deliberately NOT in it

No WhatsApp send (stub driver; assert the outbox row exists). No real UPI or payment gateway (UTR typed).
No e-invoice/e-way bill portal. No supplier bill OCR (the goods receipt is posted, not photographed —
docint is proven elsewhere). No second language. No iOS. Say each of these in the report as "not exercised",
never as "passed".

## 6. Stop rules

- **Any drift in §7 (a) or (b) stops the run.** File it as a P0 in `QA/findings/`, with the SQL, and do not
  continue to the next day pretending. The founder is told the same evening.
- A role that cannot complete its day's work in its app stops that day's story at that hop, files the
  finding, and the report says exactly which hand-off failed. Working around it through the API is
  forbidden.
- A screen that says "saved" for something not in the database is a P0 on its own (never-list #12).

## 7. The auditor — blind, independent, adversarial

A separate agent that has **not read the operator's report** computes, from SQL on `dos_test_sim` only:

(a) **Stock, per SKU per batch:** `S0 balance + Σ stock_ledger(reason ∈ receipts) − Σ(sales/pack/van
sale) − Σ(damage) − Σ(returns to stock, signed correctly) = S7 balance`, for every (variant, lot). Any
row that does not close is a P0. Also: **no negative `stock_balances`, ever**, and `sellable_stock` excludes
the damaged bin and lots under the minimum shelf life exactly as the view promises.

(b) **Money:** `Σ invoices issued − Σ credit notes = Σ receipts (net of reversals) + Σ outstanding`, per shop
and in total; **Sundry Debtors in the journal = the outstanding the owner's screen shows**; every journal
balances (a DB guarantee — assert it anyway); `CASH_VAN` nets to **0** after every settled trip; the
bounced cheque's reversal and bank charge both exist; the desk undo credited CASH not CASH_VAN.

(c) **Numbering:** invoice and receipt numbers strictly unique per series and financial year; the cancelled
invoice keeps its number with `state = cancelled`; issued invoices unchanged except derived payment state.

(d) **State machines:** every order, trip, stop and invoice ended in a state its machine allows, reached by
transitions it allows (walk the audit trail).

(e) **Isolation:** the same queries as the other two distributors' owners — zero rows of Tarsun's trade,
and `ramesh.gupta`'s three memberships show three separate books.

(f) **Idempotency:** every mutation's `idempotency_key` unique per tenant; the day-6 double upload produced
one `sync_ops` outcome.

The auditor writes `QA/evidence/simulation/audit.md` with the numbers and the SQL, and returns a verdict:
**RECONCILES** or **DRIFT** with the rows. It never rounds. It never explains a gap away.

## 8. Evidence

`QA/evidence/simulation/`: `S0.csv` and `S7.csv` (stock balances by variant and lot; journal balances by
account; outstanding by shop), one screenshot per hand-off check named `dN-<role>-<screen>.png`, the
operator's day log, and `audit.md`. `QA/25-seven-day-business-simulation.md` is written last and answers,
with numbers, the question Phase 21 asks: *would the business numbers reconcile?*

## 9. Who does what

- **Operator lane** (Opus): the seven days, strictly in order, one agent per day so each day's agent reads
  the previous day's log and its hand-off checks before it starts. Serial. Two real days.
- **Auditor** (Opus, separate, blind): §7, after day 7. Also runs §7 (a) and (b) after day 3 as a midpoint
  — a drift found on Tuesday evening is worth a day more than one found on Wednesday night.
- **Judge** (Fable, Thursday morning): reads both, rules RECONCILES / DRIFT, names what day 4 must fix.

## 10. What the founder's real extract would change

If a Distribution OS book arrives before Tuesday, a second pass runs on a **copy** of it with the same
auditor — the arithmetic is the same, the data is real. If it is an old-system export (TradeEzee, Tally,
Excel), it is not for this simulation; it is a cut-over import with its own reconciliation (docs/17 §D7).
