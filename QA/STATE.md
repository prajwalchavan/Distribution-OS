Stage: 1
Current phase: 1 — Real-user walkthrough
Status: in progress
Roles walked: Owner (web desk + phone, Android, iOS home), Manager + Accountant (web desk + phone, Android, iOS home)
Roles remaining: Warehouse, Delivery, Sales Rep, Retailer, Admin
Completed phases: 0
Open P0: none
Open P1: DOS-001, DOS-003, DOS-004, DOS-005, DOS-007, DOS-020, DOS-021, DOS-023, DOS-025, DOS-029, DOS-031, DOS-032, DOS-034, DOS-037
Approved & unimplemented: none
Blocked: none. Founder wants Fable tokens spent on testing, not fixtures — no more seed work (DOS-032's seed half is recorded, not fixed).
Next action: walk the Warehouse role (dinesh.patil / kavita.sawant, warehouse app :5176) — web first, then Pixel 7 (android-login.sh warehouse 5176 dinesh.patil Warehouse). Reuse QA/tools/pw-server.mjs + pw.mjs (EV_DIR=phase1/warehouse). Live state to use: PICK-0078 is being picked by kavita.sawant (8 orders), PICK-0079 is open and unassigned (SO-0877, 750 pc), load sheet 374f2089 is draft (TRIP-NEXT, 5 orders, 38 packages), SO-0867 confirmed with 337 pc reserved. Deliberately confirm wrong quantities and check the ledger (Charter Phase 1 Warehouse). Services run with DATABASE_URL=…/dos_qa (QA/tools/start-services.sh); restart the worker the same way if it dies.
Last updated: 2026-09-12
