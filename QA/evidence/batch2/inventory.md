# QA batch 2 inventory

Every open finding the founder approved for batch 2 on 2026-09-13 (QA/STATE.md:3, :9), built from the finding blocks in
QA/findings/ and the batch-1 review files. Machine-readable copy: `QA/evidence/batch2/inventory.json` (one record per id,
same order). Lanes: `lanes.md`. Architect brief: `fable-brief.md`.

**In scope: 141** · P0 3 · P1 25 · P2 66 · P3 47  
**Design already exists: 23** (held plan 10, architect design 10, covered by another finding's design 3)  
**Needs the architect (no design yet): 29** · of which carry a founder question: 18  
**Folded:** DOS-137 → DOS-131, DOS-156 → DOS-056 (verify each by name)  
**Re-included:** DOS-006. It was excluded as closed, but its block (QA/findings/01-walkthrough-owner.md:109) ends in an open product
decision ("per-order release vs limit change"), not a closure. No entry in docs/22, QA/13 or QA/findings/11 settles it.

Architect trigger letters, inferred from the records: (a) contract shape · (b) permission matrix · (c) schema / migration ·
(d) shared kit component contract (`frontend/libs/ui/src/types.ts`, modal architecture) · (e) cross-app data flow or module boundary ·
(f) product rule the founder must decide.

## P0 (3)

| id | title | category | role | platform | status | design | architect? | effort | flags |
|---|---|---|---|---|---|---|---|---|---|
| DOS-106 | The "support" console level has every power of the "super" level, including locking the… | security | Admin (support level) | API (the console UI offers the same buttons… | approved-held-plan | held-plan (held-review-brief.md:336) | no | L | — |
| DOS-115 | Warehouse and delivery logins can cancel, re-line and submit any order in the… | security | Warehouse, Delivery | Backend API (warehouse-service :3004,… | open | architect-design (held-review-brief.md:355) | no | M | — |
| DOS-131 | No screen in any app can create a delivery trip or add a stop, so a newly packed order… | missing-feature | Manager (also Owner, Warehouse) | Web (manager :5274, owner :5173, warehouse… | open | architect-design (held-review-brief.md:356) | no | L | — |

## P1 (25)

| id | title | category | role | platform | status | design | architect? | effort | flags |
|---|---|---|---|---|---|---|---|---|---|
| DOS-003 | Order detail lists quantities and money but no product names | bug | Owner | Web + Android | approved-held-plan | held-plan (held-review-brief.md:343) | no | S | — |
| DOS-004 | Approvals never say which shop, order or amount is being approved | ux | Owner | Web + Android | approved-held-plan | held-plan (held-review-brief.md:344) | no | M | — |
| DOS-007 | "Send statement" says it queued a statement; nothing is ever sent | bug | Owner | Web | approved-held-plan | held-plan (held-review-brief.md:338) | no | M | — |
| DOS-031 | "Start reviewing" on an already-reviewed document throws an unhandled error and leaves… | reliability | Manager | Web (dev build) | open | none | no | S | — |
| DOS-032 | Two receipts carry the same number: RCPT-0696 exists twice, and the next three office… | bug | Manager | Web + DB | approved-held-plan | held-plan (held-review-brief.md:340) | no | M | — |
| DOS-037 | The accountant can adjust stock and book supplier bills (app offers it, server accepts it) | security | Accountant | Web + API | open | none | yes (b,f) | M | — |
| DOS-043 | A warehouse user can start loading and send a trip out in one tap each, two days early,… | security | Warehouse | Web (server accepts it, so all platforms) | approved-held-plan | held-plan (held-review-brief.md:74) | no | M | — |
| DOS-044 | The warehouse can create stock out of nothing: +1,00,000 pieces posted as "opening stock"… | business-logic | Warehouse | Web (server accepts it, so all platforms) | open | none | yes (f) | M | — |
| DOS-056 | A delivery recorded without network is lost: Android drops it silently, web queues it and… | reliability | Delivery | Android + Web | approved-held-plan | held-plan (held-review-brief.md:339) | no | L | — |
| DOS-059 | Receipt numbers are issued twice: RCPT-0696 … RCPT-0699 each exist twice, and nothing… | business-logic | Delivery (and every money collector) | Web (server-side) | approved-held-plan | held-plan (held-review-brief.md:340) | no | L | — |
| DOS-074 | "N cs available" on the order screen is wrong: the app reads only the first 500 lot rows… | business-logic | Sales Rep | Web + Android (same client) | approved-held-plan | architect-design (held-review-brief.md:341) | no | M | — |
| DOS-080 | Sync pull storm: hundreds of /sync/pull calls per sign-in and ~55 per screen open | performance | Sales Rep (every field device) | Web + Android (offline client) | open | none | no | L | — |
| DOS-096 | The order screen prices everything before GST: "You pay ₹5,237.68" became an order of… | business-logic | Retailer | Web + Android | approved-held-plan | held-plan (held-review-brief.md:342) | no | M | — |
| DOS-097 | "Stock not known" for 14 of 171 products because the stock hint reads only the first 500… | bug | Retailer | Web + Android (retailer instance of DOS-074) | approved-held-plan | held-plan (held-review-brief.md:341) | no | M | — |
| DOS-098 | "Order again" repeats a random old order (a rep's order from 30 July), not the shop's… | business-logic | Retailer | Web (orders.repeatLast — same on Android) | open | none | no | M | — |
| DOS-107 | "Lock this login" has no undo anywhere in the product | missing-feature | Admin | Web + Android (API is the same) | open | none | yes (a,b) | M | — |
| DOS-108 | The owner app never shows the "Support access" tab, so no owner can approve or refuse a… | bug | Owner (the other half of the Admin… | Web desk + phone | open | none | no | M | — |
| DOS-109 | The audit trail cannot say WHO did anything: every row reads "Distribution OS staff" | security | Admin | Web + Android | open | none | yes (a) | M | — |
| DOS-116 | A desk credit note for damaged goods puts the pieces back into saleable stock unless each… | business-logic | Manager (the endpoint also serves… | Backend API (manager-service :3002, POST… | open | architect-design (held-review-brief.md:361) | no | S | — |
| DOS-117 | Overdue and ageing stop moving on days a shop has no posting: no nightly ageing rebuild… | bug | Owner, Manager, Accountant (and the… | Backend (worker + receivables); every client | open | architect-design (held-review-brief.md:358) | no | M | — |
| DOS-126 | Approving a rate request on Approvals confirms the order at the old rate, not the… | business-logic | Owner (shop and rep affected) | Web (owner app :5173, sales app :5175) +… | open | architect-design (held-review-brief.md:357) | no | M | — |
| DOS-132 | Day-end offers cash still out with a delivery crew, and trip receipts of settled trips,… | business-logic | Manager, Accountant | Web (desk 1280x800 and phone 390x844),… | open | architect-design (held-review-brief.md:359) | no | M | — |
| DOS-133 | Warehouse Load screen offers 50 arbitrary old packs as 'Packed orders'; today's packed… | bug | Warehouse | Web (warehouse :5176); code shared by… | open | architect-design (held-review-brief.md:360) | no | M | — |
| DOS-146 | Trip-start 'Cash handed to you' cannot hold any amount except the planned float: typing… | bug | Delivery | Android (Pixel_7_API_36 emulator, API 36);… | open | architect-design (held-review-brief.md:362) | no | S | — |
| DOS-164 | iOS: a Dialog opened while a Sheet is open never appears (UIKit refuses the second modal)… | bug | Manager, Accountant (Owner order… | iOS (iPhone 16 Pro simulator, iOS 18.0,… | open | none | yes (d) | L | — |

## P2 (66)

| id | title | category | role | platform | status | design | architect? | effort | flags |
|---|---|---|---|---|---|---|---|---|---|
| DOS-002 | Brand mix shows two different "Other" slices and hides the 4th and 5th brands (home and… | bug | Owner | Web | open | none | no | S | — |
| DOS-006 | Approving "Over credit limit" confirms the order but never changes the limit the request… | business-logic | Owner | Web | open | none | yes (f) | M | re-included |
| DOS-009 | Orders, Bills and Trips lists are in no order | ux | Owner | Web + Android | open | none | yes (c) | M | — |
| DOS-010 | At phone width the Orders list drops the shop name | ux | Owner | Web (390×844) + Android | open | none | no | S | — |
| DOS-011 | A receipt does not show which bills it settled or the cash discount given | missing-feature | Owner | Web | open | none | yes (a) | M | — |
| DOS-012 | "Cancel bill" is offered on a paid, delivered bill; the server refuses and the screen… | ux | Owner | Web | open | none | no | S | — |
| DOS-013 | The Default price list shows an id ("1c3586ee") instead of "Chamak Glass Cleaner 500 ml" | bug | Owner | Web | open | none | yes (a) | S | — |
| DOS-014 | "Request export" and "Export CSV" fire a fixed export with no choice and no feedback | ux | Owner | Web | open | none | yes (a,f) | M | — |
| DOS-016 | Dashboard "Outstanding" counts ₹35,080 the business has already received on account | business-logic | Owner | Web | open | none | yes (a,f) | M | — |
| DOS-017 | "Live map" has no map | missing-feature | Owner | Web + Android + iOS | open | none | no | M | — |
| DOS-022 | "9 left to bill" counts orders that cannot be billed; the one order that needs a bill has… | ux | Manager | Web | open | none | no | M | — |
| DOS-024 | "Waiting to be picked" offers orders that are already packed and billed; the refusal is… | bug | Manager | Web | open | none | no | S | — |
| DOS-026 | "Print the challan" does nothing visible | bug | Manager | Web | open | none | no | S | — |
| DOS-027 | Orders "Waiting on" column is blank for an order with two pending approvals | bug | Manager | Web | open | none | no | M | — |
| DOS-028 | Manager actions leave no audit trail (confirm, implicit approvals) | tech-debt | Manager | Web + DB | open | none | no | M | — |
| DOS-030 | A brand-DMS document offers "Book it as a supplier bill", which the server will never… | bug | Manager | Web | open | none | yes (a,f) | L | — |
| DOS-033 | A receipt shows the bill it settled as a UUID | bug | Manager | Web | open | none | no | S | — |
| DOS-035 | Shop panel prints the overdue amount in raw paise | bug | Manager, Accountant | Web | open | none | no | S | — |
| DOS-036 | The shop's "Statement of account" shows a running balance in the amount column and omits… | ux | Manager, Accountant | Web | open | none | no | S | — |
| DOS-038 | On a phone the Shops list has no shop names | bug | Manager, Accountant | Android (Pixel 7) + Web 390×844 | open | none | no | S | — |
| DOS-045 | Counts compare against a stale "expected" figure, and the expected figure is sent to the… | business-logic | Warehouse | Web (API, so all platforms) | open | none | yes (a) | M | — |
| DOS-046 | "Try it again" on a refused change replays the same stored rejection forever | reliability | Warehouse | Web (sync client, so all platforms) | open | none | no | M | — |
| DOS-047 | The Pick and Load lists hide the waves and sheets that need work | ux | Warehouse | Web, Android | open | none | no | S | — |
| DOS-048 | Server refusals are shown verbatim with UUIDs | ux | Warehouse | Web | open | none | no | M | — |
| DOS-062 | Money taken "for this bill" is booked against June's bill, the screen never says so, and… | ux | Delivery | Web + Android | open | none | no | M | — |
| DOS-063 | The stop screen does not refresh after recording a delivery or a payment | bug | Delivery | Web + Android | open | none | no | S | — |
| DOS-064 | Quantities move by whole cases only; a line under one case can only go to zero; "Not… | ux | Delivery | Web + Android | open | none | no | M | — |
| DOS-065 | The driver's inbox and the "Send the papers" screen list every shop's messages and every… | ux | Delivery | Web + Android | open | none | no | S | — |
| DOS-066 | Nothing at the door says the shop is overdue: ₹52,176 of Vaibhav's ₹75,228 is past due,… | missing-feature | Delivery | Web + Android | open | none | yes (f) | M | — |
| DOS-067 | Trip history says "Delivered on the first attempt 0%" for a driver with 104 of 125 stops… | bug | Delivery | Web + Android | open | none | no | M | — |
| DOS-068 | On the phone the app never says it is offline; reads fail with "unknown" | ux | Delivery | Android | open | none | no | M | — |
| DOS-078 | Items with zero stock and quantities beyond stock are accepted silently; the office is… | business-logic | Sales Rep | Web (client) + Backend (orders.submit) | open | none | yes (a,c,f) | M | — |
| DOS-079 | The order total omits compensation cess, so the rep's total differs from the invoice | business-logic | Sales Rep / Accountant | Backend (orders) vs billing | open | none | yes (a,c) | L | — |
| DOS-081 | Credit holds and over-limit warnings never reach the rep: "Order placed" for strict, stop… | business-logic | Sales Rep | Web (client) + Backend | open | none | yes (f) | M | — |
| DOS-082 | A price changed by the office lands silently: the rep quoted ₹1,877.76, the order is… | business-logic | Sales Rep | Web (client) + Backend | open | none | no | M | — |
| DOS-083 | The rep never sees the bill total: order screen is "before GST", the detail screen is… | ux | Sales Rep | Web + Android | open | none | no | M | — |
| DOS-084 | "Today's beat" is not today's beat: the home opens on Station Road every day | ux | Sales Rep | Web + Android + iOS | open | none | no | S | — |
| DOS-085 | Quantity entry: no keypad, pieces only go up, and "one case less" at 0 cs deletes the… | ux | Sales Rep | Web + Android | open | none | no | M | — |
| DOS-086 | Offline orders park as drafts the rep must remember to submit by hand | ux | Sales Rep | Web (offline client; Android offline… | open | none | no | M | — |
| DOS-087 | "₹15 off per case on 2+" gives ₹15 in total | business-logic | Sales Rep (shop) | Backend pricing engine | open | none | yes (f) | M | — |
| DOS-100 | The shop is never told its order is on credit hold, and hears nothing when the order is… | ux | Retailer | Web + Android | open | none | yes (a,f) | M | — |
| DOS-101 | The shop can order only whole cases: no pieces, so "Only 9 pc left" items cannot be… | missing-feature | Retailer | Web + Android | open | none | no | M | — |
| DOS-102 | One home for three distributors, but only the active one shows what is owed; sign-in… | ux | Retailer | Web + Android + iOS | open | none | yes (a,b,f) | L | — |
| DOS-103 | No way to contact the distributor, complain or ask for a return from the app | missing-feature | Retailer | Web + Android | open | none | yes (a,b,c,e,f) | L | — |
| DOS-110 | A request the console calls "Lapsed" is still "requested" to the owner's service, and… | business-logic | Admin + Owner | Web (console) + API (owner-service) | open | none | no | M | — |
| DOS-111 | The distributor never learns what support read under the window it approved | security | Owner (approver) | Web + API | open | none | no | M | — |
| DOS-112 | Per-record mutations ignore the `{id}` in the path and act on the body `id`, which the… | tech-debt | Admin + Owner (API) | API (:3007 and :3001) | open | none | no | M | — |
| DOS-121 | Load-out in the warehouse app always sends countedVanStock [] and has no van-stock count,… | missing-feature | Warehouse | Web (warehouse app :5176); the code path is… | open | none | no | M | — |
| DOS-123 | Retailer bill screen: the proof-of-delivery photo never loads on the web; the POD readUrl… | bug | Retailer | Web (desk 1280x800; the same <Img> is used… | open | none | no | S | — |
| DOS-124 | Money due → 'Pay this bill' → 'Start the payment' forgets the bill: the Pay screen opens… | ux | Retailer | Web desk 1280x800 (same routing code at… | open | none | no | S | — |
| DOS-125 | Web pay screens give a shop nothing to scan or tap: no QR image, a raw upi:// string… | missing-feature | Retailer | Web desk 1280x800 and web phone 390x844 | open | none | yes (d) | L | — |
| DOS-127 | A shop's own cancellation leaves the order's approvals pending, and the owner can neither… | bug | Owner (shop cancels) | Backend (orders.cancel under the retailer… | open | none | no | M | — |
| DOS-128 | Sales web app at phone width: catalog rows clip the item name to 4–5 letters | ux | Sales Rep | Web (sales app :5175) at 390×844 | open | none | no | M | — |
| DOS-134 | Manager Pick & pack cannot record a part-case pick row after DOS-041: whole cases only,… | bug | Manager | Web (desk 1280x800 and phone 390x844),… | open | none | no | M | — |
| DOS-136 | After a lost reply, pressing Bank it again says 'idempotencyKey was already used with a… | bug | Accountant, Manager | Web desk 1280x800, manager build :5274 | open | none | no | M | — |
| DOS-137 | A load sheet built in the warehouse app is never linked to its trip, so the crew app says… | bug | Delivery / Warehouse | Web (warehouse :5176, delivery :5177);… | folded → DOS-131 | covered by DOS-131 (held-review-brief.md:356) | no | S | — |
| DOS-138 | Once picking has started no one can cancel an order; the manager is offered Cancel order… | missing-feature | Manager | Web (manager :5274 DOS-029 build); the… | open | none | yes (f,c,e) | L | — |
| DOS-139 | Cancelling a bill before dispatch returns the stock and the money but leaves the order… | business-logic | Manager | Web (manager :5274) | open | none | yes (f) | M | — |
| DOS-140 | The sellable-stock API offers damaged-bin lots to reps and shops as available | business-logic | Sales Rep / Retailer | Backend API (sales-service :3003 GET… | open | covered by DOS-074 (held-review-brief.md:341) | no | M | — |
| DOS-147 | Android order entry: with the stock chip shown, item names and pack sizes are clipped, so… | ux | Sales Rep | Android (Pixel_7_API_36 emulator, API 36);… | open | none | no | S | — |
| DOS-148 | Delivering a bill whose order was never dispatched fails only after the photo, with the… | ux | Delivery | Android (Pixel_7_API_36 emulator, API 36) | open | none | no | M | — |
| DOS-152 | Android W5 Short sheet: the Short (save) button and the pad's last row sit below the… | bug | Warehouse | Android (Pixel_7_API_36 emulator, API 36,… | open | none | no | M | — |
| DOS-156 | Android manager app: a write pressed with no connection says 'Something could not be… | bug | Manager, Accountant (every… | Android (Pixel_7_API_36 emulator, API 36),… | folded → DOS-056 | covered by DOS-056 (held-review-brief.md:339) | no | S | — |
| DOS-157 | Android Load-out: the 'Not out of the godown yet' row collapses its status chip to '…',… | ux | Manager | Android (Pixel_7_API_36 emulator, API 36,… | open | none | no | S | — |
| DOS-160 | An idempotent replay is re-validated against the newer contract, so any additive output… | tech-debt | every app (any client that retries a… | Backend platform (idempotency + oRPC output… | open | architect-design (held-review-brief.md:363) | no | M | — |
| DOS-161 | iOS sales order entry: the fixed header and footer leave a 267-pt scroll window, so the… | ux | Sales Rep | iOS (iPhone 16 Pro simulator, iOS 18.0,… | open | none | no | M | — |

## P3 (47)

| id | title | category | role | platform | status | design | architect? | effort | flags |
|---|---|---|---|---|---|---|---|---|---|
| DOS-008 | "Open bill" keeps saying "being prepared" after the PDF is ready, until the page is… | bug | Owner | Web | open | none | no | S | — |
| DOS-015 | "Rebuild ageing" does nothing | bug | Owner | Web | open | none | no | S | — |
| DOS-018 | Internal labels leak onto the owner's screens | ux | Owner | Web + Android + iOS | open | none | no | M | — |
| DOS-019 | "Needs you (5)" lists six rows; the badge stays at 5 after two decisions | ux | Owner | Web | open | none | no | M | — |
| DOS-049 | "Blind" counts show the answer on the same screen | ux | Warehouse | Web, Android | open | none | no | S | — |
| DOS-050 | Queue rows do not say what they are: reservations without an order, "Ready to pack" with… | ux | Warehouse | Web, Android | open | none | yes (a) | L | — |
| DOS-051 | Short-pick and gate-count semantics: a silent default reason, and damaged pieces counted… | ux | Warehouse | Web | open | none | no | M | — |
| DOS-052 | The warehouse role receives retailer credit terms, and its "Inbox" is the distributor's… | security | Warehouse | Web (API) | open | none | no | M | — |
| DOS-053 | Settings and the attention strip disagree with themselves | ux | Warehouse | Web | open | none | no | M | — |
| DOS-054 | FEFO hands the picker a lot that expires in 16 days with no minimum-shelf-life rule or… | business-logic | Warehouse | Web, Android | open | none | yes (a,e,f) | L | — |
| DOS-055 | Android dev build: a React warning pops up over the whole screen on the first tap | reliability | Warehouse | Android | open | none | no | S | — |
| DOS-069 | The amount keypad sheet draws under the status bar on Android | ux | Delivery | Android | open | none | no | S | — |
| DOS-070 | "Where you were is attached as proof" while the browser has no location: the geo proof is… | ux | Delivery | Web (+ phones when location is refused) | open | none | no | S | — |
| DOS-071 | Small door-screen defects: expense needs no proof, stale "photo required" text after the… | ux | Delivery | Web + Android | open | none | yes (f) | S | — |
| DOS-072 | The crew receives the shop's credit limit and credit days | security | Delivery | API | open | none | no | M | — |
| DOS-088 | Deals to pitch: the shop card lists 6 of 14 live schemes and hides launches and the… | ux | Sales Rep | Web + Android | open | none | no | S | — |
| DOS-089 | Every screen open after 15 minutes fires a 401 on /sync/manifest before the token is… | reliability | Sales Rep | Web (offline client) | open | none | no | M | — |
| DOS-090 | A bargain request points at an order id that does not exist | tech-debt | Sales Rep / Manager | Backend | open | none | yes (e,f) | M | — |
| DOS-091 | The rep can list a shop's bills but cannot open or show one; "Due 10 Sep · 2 days" is… | missing-feature | Sales Rep | Web + Backend | open | none | no | M | — |
| DOS-092 | Cancel dialog offers "Cancel" and "Cancel order" | ux | Sales Rep | Web + Android | open | none | no | S | — |
| DOS-093 | A brand-new shop's card throws a 404 for its behaviour block | bug | Sales Rep | Web + Backend | open | none | no | S | — |
| DOS-104 | The price list loads 171 quotes and 500 stock rows (233 KB) on every open of "Place order" | performance | Retailer | Web + Android | open | none | yes (a) | M | — |
| DOS-105 | Words that mislead a shopkeeper: credit notes "To pay", a cancelled order "You pay… | ux | Retailer | Web + Android | open | none | no | M | — |
| DOS-113 | Every distributor shows two different plans: the tenant's and the subscription's | ux | Admin | Web + Android | open | none | no | S | — |
| DOS-114 | Console polish: a 400 after hand-back, "1 support requests", an unsorted People list, no… | ux | Admin | Web | open | none | no | M | — |
| DOS-118 | Phone Short sheet: the 'this batch asks for N pc' refusal line is laid out below the… | ux | Warehouse | Web, phone 390x844 (warehouse app :5176) | open | none | no | S | — |
| DOS-119 | A freshly made wave opens as 'Nothing here yet · 0 of 0 picked' with Scan and an enabled… | ux | Warehouse | Web, desk 1280x800 (the pick sheet waits on… | open | none | no | S | — |
| DOS-120 | After 'Start picking' the sheet's status chip keeps saying 'picking' next to 'N of N… | ux | Warehouse | Web, desk 1280x800 | open | none | no | S | — |
| DOS-122 | The irreversible load-out confirm dialog puts 'Send the vehicle out' and 'Cancel' on… | ux | Warehouse | Web, phone 390x844 | open | none | no | S | — |
| DOS-129 | Order footer counts cases with the first line's case size | ux | Sales Rep | Web (sales app :5175), desk and phone | open | none | no | S | — |
| DOS-130 | Owner order panel 'Stock held' shows the number of reservation rows, not the pieces held | ux | Owner | Web (owner app :5173) | open | none | no | S | — |
| DOS-141 | Refusals now reach the desk as machine sentences: record UUIDs, UTC ISO times and 'Input… | ux | Manager, Accountant | Web (desk and phone), manager build :5274 | open | none | no | M | — |
| DOS-142 | The manager's cancellation reason never reaches the rep's order screen, although the… | ux | Sales Rep / Manager | Web (manager :5274, sales :5175) | open | none | no | S | — |
| DOS-143 | Retailer 'My orders' prints the UTC date: an order placed at 3:05 am IST on 13 Sep reads… | bug | Retailer | Web (retailer :5178); code shared by… | open | none | no | S | — |
| DOS-144 | After a short pick the shop's order page still says 'You pay Rs 6,753.00' and '60 pc',… | ux | Retailer | Web (retailer :5178) | open | none | no | M | — |
| DOS-145 | The manager cannot open a given bill from search: global search lands on Registers,… | ux | Manager | Web (manager :5274) | open | none | no | M | — |
| DOS-149 | Stop screen stays stale for ~40 s after a successful delivery, still offering 'Deliver… | ux | Delivery | Android (Pixel_7_API_36 emulator, API 36) | open | none | no | M | — |
| DOS-150 | Emptied amount field still announces the previous amount to screen readers ('—' shown,… | ux | Delivery | Android (Pixel_7_API_36 emulator, API 36) | open | none | no | S | — |
| DOS-151 | Invoice and credit-note PDFs print '?' for the em dash in the tenant's own footer… | bug | Delivery / Retailer / Accountant… | Backend PDF renderer, seen in the Android… | open | none | no | S | — |
| DOS-153 | Owner Approvals: a note typed for one approval carries into the next approval opened, and… | bug | Owner | Android (Pixel_7_API_36 emulator, API 36);… | open | none | no | S | — |
| DOS-154 | Retailer Pay screen: ticking bills disables the amount field but it keeps showing the… | ux | Retailer | Android (Pixel_7_API_36 emulator, API 36);… | open | none | no | S | — |
| DOS-155 | Owner approve dialog on an order's last approval does not say it will confirm the order… | ux | Owner | Android (Pixel_7_API_36 emulator, API 36);… | open | none | no | M | — |
| DOS-158 | Android: a dialog's confirm button keeps the accessibility description 'busy' after its… | bug | Manager, Accountant | Android (Pixel_7_API_36 emulator, API 36),… | open | none | no | S | — |
| DOS-159 | Android credit-note Sheet: after typing a bill number the matching bill row sits under… | ux | Manager, Accountant | Android (Pixel_7_API_36 emulator, API 36,… | open | none | no | M | — |
| DOS-162 | Cancelling the iOS print dialog raises an uncaught PrintIncompleteException (delivery… | bug | Delivery / Retailer | iOS (iPhone 16 Pro simulator, iOS 18.0,… | open | none | no | S | — |
| DOS-163 | iOS delivery return reasons: the three-segment control overflows the line card and 'Past… | ux | Delivery | iOS (iPhone 16 Pro simulator, iOS 18.0,… | open | none | no | S | — |
| DOS-165 | iOS W5 Short sheet: the third reason chip is clipped to 'Batcl' at iPhone width and half… | ux | Warehouse | iOS (iPhone 16 Pro simulator, iOS 18.0,… | open | none | no | S | — |

## Untracked issues (no DOS id) — 43

Recorded in the findings files without a DOS block. They are **not** in batch 2 unless the right-hand column names a finding that
covers them. QA should decide at the next gate whether to file, fold or drop each one.

| # | issue | source | note | in batch 2 via |
|---|---|---|---|---|
| 1 | Order state `closed` is unreachable (§12.6) | 00-phase0-observations.md:10 | Candidate blueprint divergence: the order_state enum has closed but nothing moves an order into it. Carried to Phase 3. | — |
| 2 | Owner-approval gates narrower than the docs/22 flow (§12.7) | 00-phase0-observations.md:11 | Only credit_limit, bargain and below_floor raise an approval at submit; every other order confirms immediately. Candidate for Phase 3. | — |
| 3 | OTP absent from code (§12.5) | 00-phase0-observations.md:14 | Auth is username and password only, although OTP is documented as the next layer. otp_rate_limits is used only by password reset. | — |
| 4 | No inbound WhatsApp/SMS webhook (§12.16) | 00-phase0-observations.md:15 | Outbound handlers exist but nothing receives replies, so there is no 'reply to confirm' loop. The docs defer it. | — |
| 5 | ADR 0002 says tenant_id uuid; schema stores text (§12.4) | 00-phase0-observations.md:18 | Documentation drift; the code is internally consistent. | — |
| 6 | Dead `van_load` stock-ledger reason enum value (§12.8) | 00-phase0-observations.md:19 | No code writes this value. Tech debt. | — |
| 7 | Dead second pricing engine coexists with priceOrder() (§12.11) | 00-phase0-observations.md:20 | Two pricing code paths, only one wired, so a future edit could land in the wrong one. Phase 8 to confirm it is unreferenced. | — |
| 8 | admin-app undocumented in docs/23 screen inventory (§12.21) | 00-phase0-observations.md:21 | The app's 12 routes exist and run but the screen inventory does not list them. | — |
| 9 | x-request-id exposed through CORS but never set (§12.23) | 00-phase0-observations.md:22 | Responses carry no request id, which weakens observability. Phase 18. | — |
| 10 | OBS-1 Android manager app showed owner shell and owner-service 403s | 00-phase0-observations.md:31 | Marked WITHDRAWN in the file: a harness confound (shared :8081 Metro serving the wrong bundle). Explicitly not to be carried as a defect. | — |
| 11 | OBS-2 seeded sales rep rahul.deshmukh displays as "Demo Docs Staff (edited)" | 00-phase0-observations.md:33 | A docs:readme/smoke run renamed him and left 370 demo.docs.staff* salesperson accounts in the pilot tenant. For Phase 1 Sales and Phase 5 fixtures. | — |
| 12 | OBS-3 pilot tenant polluted with smoke/docs data (also §12.26 at line 25) | 00-phase0-observations.md:34 | 2,473 orders, 1,063 approvals and hundreds of ₹1 receipts under tarsun; the dos DB holds 6,811 tenants. A fresh dos_qa was proposed, pending the founder's word… | — |
| 13 | Retailer with three distributorships lands in Tarsun with no picker | 00-phase0-observations.md:42 | Raised as a Phase 1 Retailer question. Later filed as DOS-102 (QA/findings/06-walkthrough-retailer.md:230), which file 08 cites. | DOS-102 |
| 14 | Delivery home: "2 of 3 stops done" but "Collected today ₹0.00" | 00-phase0-observations.md:43 | Undecided whether this is a data artefact or a display issue. A text search found no matching DOS block. | — |
| 15 | Owner Today rollup silently ages when the worker is down | 00-phase0-observations.md:44 | The 'as of …' rollup gives no warning when stale. DOS-019 shows a related stale-rollup badge but does not file this. | — |
| 16 | Delivery Android asks for location permission immediately after sign-in | 00-phase0-observations.md:45 | Asked before the driver has seen any screen; open questions are whether the ask is explained and what 'Don't allow' does. No 'location permission' text in… | — |
| 17 | Retailer iOS raises the system location prompt on the sign-in screen | 00-phase0-observations.md:46 | Appears before any credentials are entered (Expo Go); why a retailer needs location at sign-in is unclear. No 'location prompt' text in other findings files. | — |
| 18 | Trial balance "Cash with delivery crews ₹1,52,536" vs dashboard "Cash in transit ₹0.00" | 01-walkthrough-owner.md:331 | Judged a seed artefact (van receipts attached to a June trip). Phase 2 must confirm a real settlement posts the transfer. | — |
| 19 | Home said "5 stops delivered" at 12:50, then 3 from 13:15 | 01-walkthrough-owner.md:332 | API and DB say 3; the 12:50 rollup could not be re-examined. Unverified, watch in Phase 2. | — |
| 20 | Seeded cash receipts carry paise | 01-walkthrough-owner.md:333 | Fixture realism issue, for Phase 5. | — |
| 21 | audit_log does not record owner approval decisions or the refused cancel | 01-walkthrough-owner.md:334 | Deferred to Phase 18. Related: DOS-028 (QA/findings/02-walkthrough-manager.md:194) covers manager actions leaving no audit trail. | DOS-028 (approval rows; the refused cancel is not covered) |
| 22 | Manager "Record a payment" has no bank-transfer option | 08-cross-role-friction.md:58 | Sourced only to QA/03 §2 (Money → Receipts); the row cites no DOS id. | — |
| 23 | Warehouse picking-sheet Scan answers "Nothing readable in frame"; no barcode route | 08-cross-role-friction.md:63 | Sourced to QA/04 §2 W5 with no DOS id. QA/findings/03-walkthrough-warehouse.md:420 lists barcode picking as NOT TESTED because headless Chromium has no camera,… | — |
| 24 | Phone width: filter chips push the list down, tab labels truncate, keyboard hints on touch screens | 08-cross-role-friction.md:95 | Owner and manager, sourced to QA/02 §4 and QA/03 §4. QA/findings/02-walkthrough-manager.md:414-415 records the chips and keyboard hint as 'P3, not filed… | — |
| 25 | iOS walked no further than sign-in and home in every role | 08-cross-role-friction.md:96 | A QA coverage gap, not a product defect: all mobile evidence is from Android. | — |
| 26 | Order panel credit line in red says "This order takes it ₹0.00 over the limit" for a shop within… | 02-walkthrough-manager.md:412 | Android manager order panel: the numbers are right but the colour and wording are wrong when nothing is exceeded. The file marks it P3, not filed separately. | — |
| 27 | Keyboard hint "j / k move · Enter open · 1 confirm · 2 cancel" shown on touch screens | 02-walkthrough-manager.md:414 | Phone width (web 390x844 and Android), under the order queue. The file marks it P3, not filed separately. | — |
| 28 | Seven order-state chips take three rows before the list starts at phone width | 02-walkthrough-manager.md:414 | Same bullet as the keyboard hint (p-orders.png). The file marks it P3, not filed separately. | — |
| 29 | Supplier-bill booking dialog promises a DRAFT bill but the row is created as approved | 02-walkthrough-manager.md:235 | Only a parenthetical inside DOS-030 (GUR/26-27/00490 booked as supplier_invoices status approved). It is separate from DOS-030's brand-DMS subject and has no… | — |
| 30 | Manager Fulfilment "Pick & pack" tab says "Nothing to pick or pack" while PICK-0078 is being picked… | 02-walkthrough-manager.md:113 | Mentioned only in DOS-023's Actual. That finding's title and fix cover the sheets list, not this tab. | — |
| 31 | Waves queue row selection draws no checkbox | 02-walkthrough-manager.md:106 | Parenthetical in DOS-023 step 1 ("it ticks — no checkbox is drawn"). Minor affordance issue, no DOS id. | — |
| 32 | iOS VoiceOver tree lists the warehouse home tile labels without their numbers | 03-walkthrough-warehouse.md:426 | Given under "Not tested" as a note for the accessibility phase. Accessibility defect on iOS (Expo Go), no DOS id. | — |
| 33 | Dev-build LogBox toast covers the primary button after an uncaught error | 04-walkthrough-delivery.md:454 | Listed under 'Also true here' with no DOS id; the file calls it environment, not product, and says it is noted in ENV.md. | — |
| 34 | Playwright setOffline does not survive between pw.mjs processes (d-43/d-44 were not really offline) | 04-walkthrough-delivery.md:15 | Test-harness caveat, not a product defect; the real offline run is d-45..d-48. | — |
| 35 | Sales Record visit dialog stays open with 'Visit recorded' until Close; beat row updates only on… | 05-walkthrough-sales.md:418 | Called 'DOS-063-style staleness' but DOS-063 covers the delivery stop screen; this sales-app screen has no id of its own. | — |
| 36 | 'Tag my position' / 'Pin this spot' give 'No position' silently; Google 'Location Accuracy' dialog… | 05-walkthrough-sales.md:421 | The file judges headless Chromium behaviour expected for the harness, not a product defect, and says no DOS id is needed ('DOS-0xx not needed'). | — |
| 37 | Missed 00:20 reporting finalize slot is not caught up after worker downtime | 10-batch1-regression.md:77 | Note under DOS-117: QA stopped the worker 22:45-00:57, so the 13 Sep finalize slot was missed. The file calls this separate from DOS-117 and says pg-boss does… | — |
| 38 | No van-stock load sheet in dos_qa, so the DOS-039 van-stock load-out path cannot be exercised | 10-batch1-regression.md:164 | Test-data gap inside DOS-121: 6 trips have van_sales_enabled, but no load sheet has non-empty van_stock. The verifier's positive van-stock case is still… | DOS-121 needs an API fixture |
| 39 | Pay-this-bill QR sheet and Pay screen give two different references for one payment | 10-batch1-regression.md:227 | Raised as a 'consider' in DOS-124's fix: the sheet quotes tr=INV-0433 while the Pay screen mints a separate PAY-... intent. | raise with DOS-124 / DOS-125 |
| 40 | Warehouse W10 Trips header says the godown may NOT create the round, contradicting the founder's… | 10-batch1-regression.md:370 | Context in DOS-131's regression status. Founder Q2 (warehouse keeps create trip and add stops) and docs/23 W10 'Trips: create' conflict with the screen copy. | DOS-043 amendment (c) |
| 41 | QA process miss: van-cash finding not filed at the DOS-034 gate as its plan and verifier required | 10-batch1-regression.md:405 | A QA process issue, not a product defect. It was filed late, as DOS-132. | filed as DOS-132 |
| 42 | Retailer Pay screen likely has the same 'amount ?? owed' snap-back as the DOS-146 cash field | 10-batch1-regression.md:702 | Implementer follow-up cited in DOS-146; retailer-app/app/pay.tsx was not walked. DOS-146's fix says to apply the same change there. | DOS-124 / DOS-154 (same lane as DOS-146) |
| 43 | Delivery app 'Record the delivery' button keeps accessibility state 'busy' after a 409 | 10-batch1-regression.md:743 | Seen inside DOS-148 in the delivery app. It matches DOS-158, which was logged for the manager app only, and DOS-148 does not cite DOS-158. The shared kit… | DOS-158 (kit Button fix; verify in the delivery app too) |

## Missing ids and orphans

- **Ids with no finding block:** none.
- **Status given but no block found:** none.
- **Excluded as closed by their own file:** DOS-006 was the only one; on reading its block it is open and is re-included above (P2, needs a founder answer).
- **Withdrawn, not carried:** OBS-1 (QA/findings/00-phase0-observations.md:31), a harness confound.
