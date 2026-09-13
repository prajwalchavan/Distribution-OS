# S-98 shared-device probe — sales app web (2026-09-13)

Run `wf_ca15a053-341` (one Opus prober, Playwright on the sales web app :5175, dos_qa). The prober could not write this file, so the main session wrote it from the prober's structured result.

| variant | status | expected | actual |
|---|---|---|---|
| V1 cross-tenant, same tab, no reload (plain dev web build, memory store) | NOT REPRODUCED | None of tenant A's shops, orders or beats visible to B at any point. | No A marker visible at any checkpoint, before or after sync. B's search for Chavan Kirana: 'Nothing matches'. A's order route: 'That order is not on this phone' (the server also answered 404 for GET /orders/a86e7342…). Order entry for A's shop: 'That shop is not on this phone'. B's positive controls matched by testID. The mechanism was never exercised: every sign-in gets a new, empty memory store, and B's first pull carried no since cursor. |
| V2 cross-tenant completeness after V1 (inherited cursor check, memory store) | NOT REPRODUCED | B holds exactly its own read set (24 shops, 218 orders), and its first pull after sign-in carries no since cursor. | Shops: 24 chip, 24 rows drawn (SQL 24). Orders: 'Showing the newest 100 of 218' (SQL 218). B's first manifest had no knownSchemaVersion; its first pull input was 'deviceId=…&limit=500' with no since. |
| V3 cross-tenant, reload between users, phone 390x844 (memory store) | NOT REPRODUCED | No tenant A rows visible to B. B's read set complete. | No A marker at any checkpoint. B's beat screen showed the app's own storage notice, 'This browser will not keep the offline copy after you close it' (memory store). Shops 24 = SQL 24; orders total 218 = SQL 218. First pull had no since cursor. A's order route: 'That order is not on this phone'. |
| V4 same tenant, different beats, same tab, no reload (memory store) | NOT REPRODUCED | A2 sees none of rahul's beat-only shops or rahul's orders, and holds its own 29 shops and 380 orders. | No rahul marker at any checkpoint. Shops 29 (SQL 29); orders 'newest 100 of 380' (SQL 380). First pull had no since cursor. Rahul's order route: 'not on this phone'; the server answered 404. |
| V5 run 1 (extra): persistent web store via COOP/COEP headers, blocked by the harness | BLOCKED | Sign-in succeeds, so the shared-device variants can run on a persistent store. | All three timed out on /sign-in. A diagnostic run showed the console error "Access to fetch at 'http://127.0.0.1:3000/auth/login' … Permission was denied for this request to access the `loopback` address space", and the screen showed 'No connection. This will send when the signal is back.' This is a harness artifact: an intercepted document has no remote address, so Chromium 145 treats it as public. It was fixed for the rerun by granting the context the 'local-network-access' permission. |
| V5A (extra) same tenant, persistent OPFS store, same tab, no reload | CONFIRMED | amit sees none of rahul's shops or orders, starts from an empty cursor, and receives his own 29 shops and 380 orders. | CONFIRMED leak plus inherited cursor. amit's first manifest sent knownSchemaVersion=36957a3c3b8da665 (rahul's) and got changed=false. His first pull carried since=eyJ2IjoxLCJ0IjoiMjAyNi0wOS0xM1QxMjoxODozNC45OTVaIn0 = {"v":1,"t":"2026-09-13T12:18:34.995Z"}, rahul's cursor, and returned 0 retailers and 0 orders. amit's shops list showed 'Shops: 30', rahul's list, including Chavan Kirana Stores and Iyer Provision Store (Khadakpada, never an amit beat) with outstanding amounts. Search 'Chavan Kirana' returned the shop. Search for his own 'Anand Bhavan Provision' returned 'Nothing matches'. Orders All: 'newest 100 of 363', rahul's count (SQL for amit 380), including SO-0875. Rahul's order route rendered SO-0875, Balaji Wholesale Stores, Packed, 10 lines, total 1,01,531.00, while the server answered 404 to amit for GET /orders/a86e7342…. amit's beat: 'No beat today, Shops: 0'. |
| V5B (extra) cross-tenant, persistent OPFS store, same tab, no reload | NOT REPRODUCED | No tenant A rows visible to B at any moment. | No leak in either run. Node poll: 1416 samples, no hit. Watcher: no hits over 90 s. The early shops list showed 'Shops: 0 / No shops on this phone yet'; the tenant check re-snapshotted, and B's first pull had no since. After sync: shops 24 and orders 218, both equal to SQL. Observation, cause not isolated: after sign-in the first manifest answered 200 at about +130 ms, but no pull started until the next manifest about 60 s later, so kiran looked at an empty phone for a minute (a 401 on GET /sync/manifest was also logged). |
| V5C (extra) cross-tenant, persistent OPFS store, reload between users (app restart), phone 390x844 | CONFIRMED | No tenant A (tarsun) rows visible to B (sai) at any moment. | CONFIRMED in both runs. Run 1: the in-page watcher recorded Chavan Kirana Stores and Iyer Provision Store (text and shop-row testIDs a029f31b…, 21789c58…) plus tarsun beat names Khadakpada and Kalyan West Market on /shops. Run 2, Node poll 394 ms after kiran's sign-in click: the screen shows header 'Sai Distributors, Dombivli / salesperson', 'Shops: 30' and tarsun shops with codes, beats and outstanding amounts (Ambika Provision Store R-0009 23,995.00; Balaji Wholesale Stores R-0010 7,20,804.00; Bhosale Traders R-0023; Chavan Kirana Stores R-0024 21,892.00; Deshmukh Kirana R-0017 …). The saved body text lists rahul's tarsun shops, and the leak was still visible after the screenshot (stillVisibleAfterShot=true). The window then closed when the manifest handshake re-snapshotted: the early checkpoint showed kiran's own rows (23, then 24), and all later checkpoints were clean (shops 24 = SQL, orders 218 = SQL). |

## Recommendation

{"severity": "P0", "category": "security/tenant-isolation (offline device store)", "title": "Sign-out leaves the sales app's device store in place: the next user inherits rows and cursor; another tenant's shops show after an app restart", "businessImpact": "With a persistent store (expo-sqlite on Android/iOS, OPFS on a hosted web build that sends COOP/COEP), a shared or reassigned rep phone shows one user's data to the next. Cross-tenant, measured: after a restart, a Sai Distributors rep's Shops screen listed 30 Tarsun Enterprise shops with codes, beats and outstanding dues. That is a competitor distributor's customer book and receivables, on the never-list. Same tenant, measured: a colleague keeps the previous rep's shops, 363 orders and full order details (lines, totals) indefinitely, while the server refuses him those orders with 404. He also inherits the previous rep's sync cursor, so his own beat never arrives: 'No beat today', none of his 29 shops, the wrong order book. He cannot work his route, and nothing on screen says anything is wrong ('Updated just now'). Not reproduced on the plain dev web build only because that store is memory-only and new at every sign-in. Native devices were not tested (no emulator allowed in this session); they use the same file-per-app shape ('dos-sales.db').", "suggestedFix": "1) Wipe on sign-out: call SyncEngine.wipe() (frontend/libs/offline/src/engine.ts:200, currently no caller) from the app's signOut path. OfflineProvider's cleanup only calls stop(). Surface status().pending first, and do the same for the delivery and warehouse apps. Also clear the per-shop draft keys 'dos.sales.draft.*' (V1 showed 'dos.sales.draft.a029f31b…' surviving sign-out in localStorage; value not read). 2) Defence in depth: key the device database per user and tenant (databaseName like dos-sales-<userId>-<tenantId>.db instead of the fixed name at frontend/sales-app/app/_layout.tsx:299, delivery-app :299, warehouse-app :305), and store userId in sync state. 3) In start(), do not restore shapes or emit table changes (engine.ts:165-181) until the manifest handshake has run, or until the stored tenantId/userId matches the signed-in session. Add userId to the stale check in applyManifest (engine.ts:341-345: today same role, same schema hash and same tenant count as not stale, which is why the cursor carries over). 4) Add offline engine specs for: sign-out then a different user, same tenant (no rows, no since); cross-tenant with a restart between users (no rows rendered before the handshake); then rerun this probe (QA/tools/e2e/s-098-shared-device.mjs v5a v5b v5c) and repeat V5A/V5C on the Pixel 7 dev build."}

## Evidence

- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-02-a-shops-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-04-a-order-detail-so0875-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-06-signed-out-same-tab-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-07-b-kiran-beat-right-after-sign-in-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-08-b-shops-early-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-10-b-A-order-detail-early-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-13-b-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-15-b-search-own-aditya-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-17-b-A-order-detail-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-18-b-A-shop-order-entry-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-19-b-shops-synced-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v1.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v1.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-12-b-shops-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v1-16-b-orders-all-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v3-02-a-search-chavan-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v3-03-signed-out-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v3-04-after-reload-sign-in-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v3-05-b-beat-right-after-sign-in-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v3-09-b-search-chavan-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v3-11-b-A-order-detail-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v3-v4.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-01-a-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-03-signed-out-same-tab-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-06-a2-shops-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-07-a2-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-09-a2-search-own-anand-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-10-a2-orders-all-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v4-11-a2-A-order-detail-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v3-v4.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5-diag-sign-in-under-coop-coep-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v5-run1-blocked-loopback.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-02-a-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-04-signed-out-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-07-second-shops-early-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-08-second-beat-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-09-second-shops-synced-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-10-second-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-11-second-search-own-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-12-second-orders-all-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5a-13-second-A-order-detail-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v5a-v5b-v5c.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5b-04-signed-out-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5b-06-second-beat-right-after-sign-in-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5b-07-second-shops-early-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5b-10-second-search-chavan-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5b-11-second-search-own-desk.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v5b-v5c.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v5a-v5b-v5c.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5c-leak-first-hit-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5c-leak-first-hit-phone.txt
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5c-04-signed-out-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5c-05-after-reload-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5c-06-second-beat-right-after-sign-in-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/v5c-07-second-shops-early-phone.png
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v5b-v5c.json
- /Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/s-098/results-v5a-v5b-v5c.json

## Cleanup

Stopped every sales Metro I started, each by pid: run 1 pnpm 38914 / sh 38939 / expo 38941; run 2 43095 / 43109 / 43111; run 3 45639 / 45653 / 45655. After the last kill, lsof shows nothing listening on 5175, curl gets connection refused, and no 'expo start --web --port 5175' process remains. Every browser context I opened on the shared Chromium (CDP :9333) was closed, and OPFS data went with those incognito contexts. The shared Chromium's only remaining target is another lane's page (http://localhost:5179/distributors/new), which I did not touch. I did not restart any service, build any library, start an emulator or simulator, touch .claude/worktrees, or edit product code, docs or other QA files. Files created: the probe script, the evidence folder with its screenshots, text dumps and results JSON, and the Metro logs $HOME/.dos-qa-logs/logs/s098-sales-web.log, -2.log and -3.log. The only side effects on dos_qa are the auth sessions and events from normal sign-ins; no orders, visits or other writes were made.
