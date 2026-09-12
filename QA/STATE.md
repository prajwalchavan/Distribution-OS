Stage: 1
Current phase: 1 — Real-user walkthrough
Status: in progress
Roles walked: Owner (web desk + phone, Android, iOS home), Manager + Accountant (web desk + phone, Android, iOS home), Warehouse (web desk + phone, Android, iOS home), Delivery (web desk + phone, Android incl. camera/offline/background, iOS home)
Roles remaining: Sales Rep, Retailer, Admin
Completed phases: 0
Open P0: DOS-039 (load-out confirm deducts packed stock a second time — nothing can leave the godown)
Open P1: DOS-001, DOS-003, DOS-004, DOS-005, DOS-007, DOS-020, DOS-021, DOS-023, DOS-025, DOS-029, DOS-031, DOS-032, DOS-034, DOS-037, DOS-040, DOS-041, DOS-042, DOS-043, DOS-044, DOS-056, DOS-057, DOS-058, DOS-059, DOS-060, DOS-061
Approved & unimplemented: none
Blocked: none. Founder wants Fable tokens spent on testing, not fixtures — no more seed work (the RCPT counter collision, DOS-059, is left as found). DOS-039 blocks any real dispatch. TRIP-ACTIVE (ganesh.more) now has stops 1–5,7,9,10 done, 6 failed, 8 arrived; it was deliberately NOT checked in so the sales/retailer walks still have a live trip. Receipt numbers RCPT-0696..0699 are duplicated in dos_qa (DOS-059) — expect the next app receipt to be RCPT-0700 (unique again).
Next action: walk the Sales Rep role (rahul.deshmukh / amit.pawar / pooja.shinde, sales app :5175, sales-service :3003) — web first (EV_DIR=phase1/sales, pw-server on :9333 is up; sign in with `pw.mjs login rahul.deshmukh Dos@1234 http://localhost:5175/`), then Pixel 7 (`android-login.sh sales 5175 rahul.deshmukh Sales`; note the app reaches the API over adb reverse — see ENV.md for the offline recipe), then iOS home (`ios-login.mjs 5175 rahul.deshmukh sales`, Appium on :4723 is up). Charter Phase 1 Sales list: retailer discovery/creation, product search, order build with the messy cases (zero/negative/huge qty, unavailable stock, discontinued, changed price, expired scheme, blocked retailer, beyond credit limit — Vaibhav Kirana Mart owes ₹67,372 with ₹44,320 overdue, Khan General Store is credit_mode `stop`), schemes/credit/outstanding visibility, submit/modify/cancel/repeat, history, offline. Services run with DATABASE_URL=…/dos_qa (QA/tools/start-services.sh); restart the worker the same way if it dies.
Last updated: 2026-09-12
