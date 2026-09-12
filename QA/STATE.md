Stage: 1
Current phase: 1 — Real-user walkthrough
Status: in progress
Roles walked: Owner (web desk + phone, Android, iOS home), Manager + Accountant (web desk + phone, Android, iOS home), Warehouse (web desk + phone, Android, iOS home)
Roles remaining: Delivery, Sales Rep, Retailer, Admin
Completed phases: 0
Open P0: DOS-039 (load-out confirm deducts packed stock a second time — nothing can leave the godown)
Open P1: DOS-001, DOS-003, DOS-004, DOS-005, DOS-007, DOS-020, DOS-021, DOS-023, DOS-025, DOS-029, DOS-031, DOS-032, DOS-034, DOS-037, DOS-040, DOS-041, DOS-042, DOS-043, DOS-044
Approved & unimplemented: none
Blocked: none. Founder wants Fable tokens spent on testing, not fixtures — no more seed work. DOS-039 blocks any real dispatch: the Delivery walk must use the seeded active trip (TRIP-ACTIVE, 3 of 10 stops) and note that no new trip can be loaded through the app.
Next action: walk the Delivery role (ganesh.more / iqbal.shaikh / raju.yadav / santosh.kamble, delivery app :5177) — web first, then Pixel 7 (android-login.sh delivery 5177 ganesh.more Delivery), then iOS home (ios-login.mjs 5177 ganesh.more delivery). Reuse QA/tools/pw-server.mjs + pw.mjs (EV_DIR=phase1/delivery). Live state: TRIP-ACTIVE (MH-05-AB-1234, 12 Sep, 3 of 10 stops, driver id 7b2db500 = check which username) is the only usable trip; TRIP-NEXT is `active` with nothing loaded (QA artefact of DOS-043) — expect the driver to see an empty second trip. Turn the network off (Playwright context.setOffline / adb shell svc wifi disable) and try deliveries + collections offline (Charter Phase 1 Delivery). Services run with DATABASE_URL=…/dos_qa (QA/tools/start-services.sh); restart the worker the same way if it dies.
Last updated: 2026-09-12
