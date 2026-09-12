# Phase 1 approval gate — 2026-09-12

Phase 1 (real-user walkthrough, all seven roles, web + Android + iOS home) is complete.
Counts from `QA/findings/01…07-walkthrough-*.md`: **P0 4 · P1 38 · P2 47 · P3 25**.
Nothing has been changed in the product. This sheet is the decision aid for the gate; the
evidence blocks stay in the per-role files.

## P0 — must be fixed before anything else is believed

| ID | Role | What it does to the business | File |
|---|---|---|---|
| DOS-039 | Warehouse | Load-out confirm deducts the packed orders' stock a second time. **Nothing can leave the godown**, so Phase 2 cannot run past load-out. | 03 |
| DOS-073 | Sales Rep | A salesperson can cancel any other rep's confirmed order and read every order of the tenant through the API. | 05 |
| DOS-094 | Retailer | "Pay everything" hands the shop a UPI intent for one bill's original total under the invoice number, not the amount chosen nor the PAY reference; the intent URL is malformed. Wrong money, unmatched. | 06 |
| DOS-106 | Admin | The "support" console level has every "super" power: it repriced a distributor to ₹0.01, onboarded and suspended tenants, and locked the super out. | 07 |

## P1 — 38, grouped by where they sit on the Phase 2 chain

Phase 2 walks: rep order → manager approval → warehouse pick/pack/load-out → delivery → retailer → payment → owner's numbers.
**30 of the 38 sit on that chain**; the other 8 can follow Phase 2.

**Order hop (rep, retailer, manager) — 8**
- DOS-020 "Confirm order" silently approves the pending approvals and walks through a credit stop (Manager)
- DOS-029 The manager app swallows every server refusal: 400, 409 and 501 all look like "nothing happened"
- DOS-074 "N cs available" reads only the first 500 lot rows and never pages (Sales)
- DOS-075 The live "2% off on bills over ₹25,000" scheme never applies (Sales)
- DOS-076 A brand-scoped cash discount (Too Yumm 2%) is granted on the whole bill (Sales)
- DOS-077 Android: order-entry catalog rows are blank — 171 anonymous "Add a case" buttons (Sales)
- DOS-096 The retailer order screen prices everything before GST; ₹5,237.68 became ₹5,855.00 on placing
- DOS-097 "Stock not known" for 14 of 171 products: the stock hint reads only 500 lot rows (Retailer)

**Pick / pack / load-out — 6**
- DOS-040 A wave cannot be started from the app; picks on an unstarted wave are rejected while the screen counts them as picked
- DOS-041 Picking more than the lot line asks for is accepted; the pack is then refused and the order cannot ship
- DOS-042 The wave closes as "picked" with a line neither picked nor shorted, and a closed wave cannot be corrected
- DOS-043 A warehouse user can start loading and send a trip out in one tap each, two days early, with a draft load sheet
- DOS-023 A picking sheet the manager just made vanishes: the sheets list is 50 unsorted rows
- DOS-025 The load sheet waiting for the manager's approval is not on the Load-out screen

**Delivery — 5**
- DOS-056 A delivery recorded without network is lost: Android drops it silently, web queues it and the office refuses it
- DOS-057 No paper can be opened, printed or sent: the signed link is relative, receipts are never rendered
- DOS-058 Choosing "Damaged" for a returned case still puts it back into saleable stock
- DOS-060 The phone's amount keypad counts paise: typing 4-7-5-6 records ₹47.56
- DOS-061 "Today's trip" is the wrong trip; today's real trip is a dead end from the home and unreachable offline

**Payment / money desk — 5**
- DOS-032 Two receipts carry the same number (RCPT-0696 twice) and the next three office receipts will collide (Manager)
- DOS-059 Receipt numbers are issued twice (RCPT-0696…0699) and nothing stops it (Delivery + every collector)
- DOS-034 Day-end has no action: nothing banks cash, deposits a cheque or marks a bounce (Manager, Accountant)
- DOS-095 The retailer statement stops after 50 entries; the last four payments are missing, the balance jumps
- DOS-099 The bill PDF cannot be opened on any platform: the API returns a relative `/storage/…` URL (Retailer)

**Returns (Phase 2 "days that go wrong") — 1**
- DOS-021 Credit notes cannot be drafted for less than a full case, and the server's refusal is invisible (Manager)

**Owner's numbers — 5**
- DOS-001 Home dashboard hides the 90+ day debt: shows ₹0.00 while ₹35,144 is over 90 days old
- DOS-003 Order detail lists quantities and money but no product names
- DOS-004 Approvals never say which shop, order or amount is being approved
- DOS-005 A bargain shows up twice on Approvals; rejecting one copy leaves the other open
- DOS-007 "Send statement" says it queued a statement; nothing is ever sent

**Off the chain — 8 (can follow Phase 2)**
- DOS-031 "Start reviewing" on an already-reviewed document throws and leaves the page unclickable (Manager)
- DOS-037 The accountant can adjust stock and book supplier bills (app offers it, server accepts it)
- DOS-044 The warehouse can create stock out of nothing: +1,00,000 pieces as "opening stock", no approval
- DOS-080 Sync pull storm: hundreds of /sync/pull calls per sign-in, ~55 per screen open (every field device)
- DOS-098 "Order again" repeats a random old order and creates a server draft on every tap (Retailer)
- DOS-107 "Lock this login" has no undo anywhere in the product (Admin)
- DOS-108 The owner app never shows the "Support access" tab, so no owner can approve or refuse support (Owner)
- DOS-109 The audit trail cannot say WHO did anything: every row reads "Distribution OS staff" (Admin)

## Recommendation

1. **Smallest batch that lets Phase 2 start at all:** DOS-039, plus DOS-040 (a wave can be started) and
   DOS-025 (the manager can see and approve the load sheet). Without these three the chain stops at the godown door.
2. **Recommended batch before Phase 2:** the 4 P0 + the 30 on-chain P1 (34). Phase 2 verifies every hop in UI,
   API and DB; with these open, most hops either cannot be completed or produce a number that is already known
   to be wrong, so the Phase 2 result would mostly restate Phase 1.
3. The 8 off-chain P1 and all P2/P3 can wait for Phase 3 (change backlog).

Founder's words (Charter A.6): "Continue" · "Fix P0/P1" · "Implement all approved" · "the product is right".
On any "Fix": checkpoint commit first (A.14), product changes in their own commits, then the five regressions
of A.12 into `QA/14-regression-results.md`.
