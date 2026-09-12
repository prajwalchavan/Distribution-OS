# 08. Cross-role friction (Phase 1 close-out, 2026-09-12)

The list Phase 1 asks for at its end: friction, unnecessary steps, confusing terminology, missing workflows, poor defaults, missing
shortcuts, repetitive data entry, unclear statuses and poor mobile UX, seen across all seven roles. It draws only on the seven role
reviews (`QA/02-owner-review.md` … `QA/08-admin-review.md`) and the seven walkthrough finding files (DOS-001 … DOS-114); nothing here
is new observation.

### Friction

- **Owner, manager, warehouse, admin:** lists arrive unsorted and capped at 50 rows, so the newest or actionable row is never on top; the picking sheet the manager had just made was invisible for exactly this reason (DOS-009, DOS-023, DOS-047, DOS-114).
- **Owner:** approvals never name the shop, the order or the amount, so the owner must phone someone before every decision (DOS-004; QA/02 §1).
- **Delivery, owner:** screens keep the old state after a write; the stop still reads "Not started" and "Owes ₹75,228" until a reload, and a rendered bill still says "being prepared" (DOS-063, DOS-008).
- **Delivery:** "Send the papers" is a scroll of ten old receipts and twenty messages before anything from today, and the driver's inbox carries every shop's messages (DOS-065).
- **Warehouse:** a refused change lands in the attention tray where "Try it again" replays the same stored rejection forever (DOS-046).
- **Retailer:** three distributors sit behind one sign-in but only the active card shows an amount, so the ₹91,494 owed in total is never visible together (DOS-102; QA/07 §4).
- **Manager:** the day's queue is spread over Orders, Billing, Fulfilment, Inbound and Money, and wave rows are selected by a click with no visible checkbox before the primary button appears (DOS-023; QA/03 §5).
- **Admin:** a locked login has no unlock anywhere in the product; two accounts had to be restored with SQL (DOS-107).

### Unnecessary steps

- **Retailer:** every tap of "Order again" creates a server draft, and the basket it repeats is a six-week-old rep order rather than the shop's last one (DOS-098).
- **Sales rep:** an order taken offline parks as a draft the rep must remember to open and submit by hand (DOS-086).
- **Delivery:** a return needs two rows of chips for one decision (saleable or damaged bin, then refused, damaged or expired), and the obvious tap puts damaged stock back on sale (DOS-058; QA/05 §4).
- **Owner:** "Open bill" needs a full page reload before it notices the PDF the worker has already rendered (DOS-008).
- **Warehouse:** "Take it to packing" only moves the picker to the Pack tab, and with no Start on a wave the picks are counted on screen and then thrown away by the sync layer (DOS-040; QA/04 §5).
- **Admin, owner:** per-record mutations ignore the id in the URL and act on the id in the body, so every caller has to send it twice (DOS-112).

### Confusing terminology

- **Owner:** internal ids and enums reach the owner's screens (POST_FULFILLMENT, bargain_request, TRIP-ACTIVE, "Scheme fd5079b5"), and the Default price list prints "1c3586ee" where a product name belongs (DOS-018, DOS-013).
- **Manager, warehouse, delivery:** refusals and panels show machine text: a receipt's bill as a UUID, overdue amounts in raw paise, verbatim UUID errors, a zod array as a refusal, "unknown" as an error, User-Agent strings as device names (DOS-033, DOS-035, DOS-048, DOS-053, DOS-056, DOS-068).
- **Warehouse:** state words contradict the screen: "reconciled" for a GRN with five open findings, "picked" for a wave with an unpicked line, damaged pieces reported as excess (DOS-042, DOS-051).
- **Retailer:** the shop-facing words mislead: a credit note badged "To pay", a cancelled order that still says "You pay ₹1,977", "You asked" for a rate the rep asked for, an ISO date inside a WhatsApp reminder (DOS-105).
- **Sales rep:** "Order placed" is shown for an order the office is holding, "Due 10 Sep · 2 days" means two days overdue, and the cancel dialog offers "Cancel" beside "Cancel order" (DOS-081, DOS-091, DOS-092).
- **Manager, delivery:** internal phrasing on operational screens: "Not ordered" on a bill line, "Off the line", "0 packs already gone out", "Owed ₹ / Money owed" (DOS-064; QA/03 §5).
- **Admin:** the console never says whether an account is super or support (both read "Distribution OS staff") and shows two different plans for every distributor (DOS-109, DOS-113).

### Missing workflows

- **Manager, accountant:** nothing in the app banks cash, deposits a cheque or marks a bounce; Day-end is read-only (DOS-034).
- **Manager:** the load sheet waiting for the manager's approval is not on the Load-out screen, and a picking sheet once made cannot be found, assigned or cancelled (DOS-025, DOS-023).
- **Warehouse:** a wave cannot be started from the app, and once closed it cannot be corrected or reopened by the picker (DOS-040, DOS-042).
- **Owner:** "Send statement" and "Rebuild ageing" report success and do nothing, "Live map" has no map, and the Support access tab never renders, so no owner can answer a support request (DOS-007, DOS-015, DOS-017, DOS-108).
- **Delivery, retailer, sales rep:** no paper reaches anyone: bills fail on a relative signed URL, receipts are never rendered, and the rep can list a shop's bills but not open one (DOS-057, DOS-099, DOS-091).
- **Retailer:** no phone number, reply box, complaint or return request exists; Returns tells the shopkeeper to message the distributor and offers no way to do it (DOS-103).
- **Admin, owner:** a locked login cannot be unlocked, Subscriptions is a read-only list, and the distributor is never told what support read under the window it approved (DOS-107, DOS-111, DOS-114).
- **Owner:** a receipt never shows which bills it settled or the cash discount that closed the gap to the bill total (DOS-011).

### Poor defaults

- **Sales rep:** the morning list opens on Station Road every day instead of the beat scheduled for that day (DOS-084).
- **Delivery:** "Today's trip" picks the 14 Sep trip rather than the one on the road, so the diesel expense landed on the wrong trip and today's real trip is a dead end from the home screen (DOS-061).
- **Retailer:** sign-in lands in the first distributor without asking, and "Order again" defaults to a random old order (DOS-102, DOS-098).
- **Retailer, sales rep:** order screens price everything before GST; "You pay ₹5,237.68" became ₹5,855.00 on placing, and the rep's footer total omits GST and, on the bill, cess (DOS-096, DOS-083, DOS-079).
- **Warehouse:** a short pick with no reason chosen is accepted with a reason defaulted silently, and FEFO hands over a lot expiring in 16 days with no minimum shelf life rule or warning (DOS-051, DOS-054).
- **Warehouse:** "blind" counts print the expected figure on the same screen, and the API returns it to the counting device anyway (DOS-045, DOS-049).
- **Owner:** "Export CSV" and "Request export" fire one fixed export with no choice and no feedback (DOS-014).
- **Manager:** "Record a payment" offers cash, UPI and cheque only, with no bank transfer option (QA/03 §2, Money → Receipts).

### Missing shortcuts

- **Owner, manager:** there is no sort control and no date-column sort on any list; "7 / 30 / 90 days" is the only control the owner has (DOS-009; QA/02 §5).
- **Warehouse:** the picking sheet's Scan button answers "Nothing readable in frame", so there is no barcode route to a line (QA/04 §2, W5).
- **Retailer:** the desk payment screen shows the raw upi:// string as text with no QR to scan (DOS-094; QA/07 §4).
- **Delivery:** nothing jumps to today's documents on the papers screen, and no stop carries an overdue or credit-mode signal the crew could act on (DOS-065, DOS-066).
- **Admin:** the audit trail has no filter and no reason column, so the rows cannot be narrowed to one action or one person (DOS-109).
- **Sales rep:** "Repeat last order" is three taps and on the Pixel it is the only usable path, because the catalog rows are blank (DOS-077; QA/06 §1).

### Repetitive data entry

- **Sales rep:** pieces only step up, so eighteen pieces is eighteen taps, and "one case less" at zero cases throws the pieces away and the line has to be built again (DOS-085).
- **Delivery:** a delivery recorded without network is dropped on Android and refused on web, and "Send it again" sends nothing, so the whole door record must be keyed a second time (DOS-056).
- **Warehouse:** a mis-keyed pick cannot be cancelled or reopened by the picker and the attention tray only replays the stored rejection, so the correction has to be re-entered at the desk (DOS-041, DOS-042, DOS-046).
- **Admin, owner:** the record id must be repeated in the body of a per-record mutation or the call answers 500 (DOS-112).

### Unclear statuses

- **Owner:** the home shows 90+ debt as ₹0.00 while ₹35,144 is that old, "Needs you (5)" lists six rows and stays at 5 after two decisions, and "2 trips active" is one active plus one planned (DOS-001, DOS-019, DOS-018).
- **Manager:** "Waiting on" is blank for an order with two pending approvals, "Bills to issue 8" counts orders that cannot be billed, and "Cash to bank" lists UPI and bank rows as cash in hand (DOS-027, DOS-022, DOS-034).
- **Manager, owner, warehouse:** server refusals are swallowed, so a 400, 409 or 501 looks exactly like nothing happening, including a Cancel bill and a pick queue action the server rejected (DOS-029, DOS-012, DOS-024).
- **Warehouse:** one pick screen carries three contradicting counts, a wave closes as "picked" with an unpicked line, queue rows do not say which order or shop they belong to, and the settings counters disagree with the attention strip (DOS-042, DOS-050, DOS-053).
- **Delivery:** trip history reports "Delivered on the first attempt 0%" for a driver with 104 of 125 stops delivered and omits today's trip, and a collected payment leaves the bill still marked owed because it settled a June bill (DOS-067, DOS-062).
- **Sales rep, retailer:** neither is told the order is on credit hold ("Order placed" for strict, stop and warn shops alike), and the stock hint says "0 cs available" or "Stock not known" for items sitting in the godown (DOS-081, DOS-100, DOS-074, DOS-097).
- **Retailer:** the statement stops after 50 entries with the last four payments missing, so the running balance jumps from ₹63,535 to a closing ₹35,843 (DOS-095).
- **Admin:** the home tile reads "0 support requests waiting" with three pending, and a request the console calls "Lapsed" is still "requested" to the owner's service (DOS-110).

### Poor mobile UX

- **Sales rep:** on the Pixel the order catalog draws 171 blank "Add a case" buttons with no name, pack or stock, leaving repeat-order as the only usable path (DOS-077).
- **Owner, manager:** at phone width and on Android the Orders list drops the shop name and the Shops list has no shop names at all (DOS-010, DOS-038).
- **Delivery:** the Android amount keypad counts paise, so typing 4756 records ₹47.56, and the keypad sheet draws under the status bar (DOS-060, DOS-069).
- **Delivery:** on the phone the app never admits it is offline (the strip still says "Updated just now") and a delivery recorded offline on Android vanishes with no queue and no message (DOS-068, DOS-056).
- **Warehouse, retailer:** the Android dev build throws a full-screen React warning over the first tap, and the same LogBox appears on the retailer's bill screen (DOS-055, DOS-099).
- **Retailer:** the UPI intent the app builds is malformed on a real phone (`upi://pay?upi://pay?…`) and opens nothing (DOS-094).
- **Owner, manager:** at 390 px the filter chips push the list a screen down, tab labels truncate ("Outstan…", "Incenti…") and keyboard hints are shown on a touch screen (QA/02 §4, QA/03 §4).
- **All seven roles:** iOS was walked no further than sign-in and home in every role, so the mobile evidence is Android's (QA/02 §4, QA/03 §4, QA/04 §4, QA/05 §2, QA/06 §6, QA/07 §2, QA/08 §2).

### Themes that cut across every app

- **Documents never reach a human.** Relative signed URLs and receipts that are never rendered break open, print and share in four apps (DOS-057, DOS-099, DOS-008, DOS-026, DOS-091).
- **Actions offered that the server refuses, with no message on screen** (DOS-012, DOS-021, DOS-024, DOS-029, DOS-030).
- **Machine text in front of users:** UUIDs, enum names, raw paise, zod JSON, User-Agent strings (DOS-013, DOS-018, DOS-033, DOS-035, DOS-048, DOS-053).
- **Lists unsorted, id-ordered and capped at 50,** which hides exactly the rows that need work (DOS-009, DOS-023, DOS-047, DOS-095, DOS-114).
- **Whole cases only,** in credit notes, delivery returns, rep order lines and the shop's own basket (DOS-021, DOS-064, DOS-085, DOS-101).
- **Android rows that render without their text,** next to phone layouts that drop the identifying column (DOS-077, DOS-010, DOS-038).
