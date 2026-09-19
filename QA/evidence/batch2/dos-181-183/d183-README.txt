DOS-183 — "on the web, unsent work does NOT go first at the next sign-in"
BROWSER PROOF, 2026-09-20. VERDICT: PASS on both paths the finding measured.

Founder answer A (2026-09-14): unsent changes stay on THAT device for THAT person and go FIRST at
that person's next sign-in. The finding measured the opposite on web — a sign-in over a kept file
uploaded at +60 753 ms (the poll tick), and a page that booted offline made no call for 49.5 s after
a real `online` event.

WHAT WAS OPERATED (nothing inferred from code)
  the sales app in a real headed Chromium, Metro :5185 -> backend/all-in-one :3100 -> postgres
  dos_test_b2_d183. Signed in as rahul.deshmukh. Ports :3000-:3007 were held by another lane and
  were NOT killed. dos and dos_qa were never touched.

THE TWO MEASUREMENTS (from d183v2-verdict-corrected.txt; run 1 in d183-result.json agrees)

  RUN B — the next sign-in over a file whose previous session never ran end().
    State built by hand: order saved on this phone while offline, then the OTHER tab signed out
    (clearing the shared session, so tab 1's engine was stopped and never end()ed), then the window
    was closed. Relaunching the same profile gave the sign-in form with the 3.9 MB OPFS file still
    on disk holding the unsent order.
      POST /sales/sync/upload    +287 ms after the Sign in tap     (finding: +60 753 ms)
      GET  /sales/sync/manifest  +405 ms
      GET  /sales/sync/pull      +417 ms, carrying a cursor (a delta, so the read set was kept)
    The page's own resource timing agrees to within 1 ms: 286 / 404 / 417.
    Each of the two ops was uploaded once and answered 200. Office: one sales_orders row, one line.
    Run 1, an independent profile: upload +328 ms, manifest +487, pull +502.

  RUN C — a page that BOOTED OFFLINE and then found the network.
    Order saved offline, page RELOADED with the services unreachable (it booted from the device
    store: "No signal", 171 items on this phone, "2 waiting to send"), then 150 s with no signal, then
    the radio restored.
      the browser's own `online` event fired at the restore
      POST /sales/sync/upload    +38 ms after that event           (finding: 49.5 s)
      GET  /sales/sync/manifest  +242 ms
      GET  /sales/sync/pull      +258 ms
    Why this is the reconnect and not a retry that happened to land there: the engine's upload
    backoff had run 8.5, 9.5, 11.6, 15.6, 23.7, 39.8, 71.8, 131.9 s since the offline boot — at its
    60 s cap — and the reconnect came 30 716 ms after that last attempt, so the next retry was still
    ~29 s away.
    Run 1, without the soak: upload +36 ms after the restore, manifest +211, pull +226.

NOTHING REGRESSED
  the pull still happens on both paths, after the upload, and in run B it is a delta;
  every op was ACCEPTED exactly once (sync_ops holds 4 rows for this device, all {"ok": true}, no
  duplicate op_id);
  each order landed in the office exactly once (one sales_orders row + one sales_order_lines row).

  ONE THING THAT LOOKS LIKE A DOUBLE SEND AND IS NOT. In run C the same two opIds appear in two POSTs:
      +38 ms  POST /sales/sync/upload -> 401   the access token expired during the 150 s with no signal
      +49 ms  POST /auth/auth/refresh -> 200   @dos/api-client's one transparent refresh per 401
      +108 ms POST /sales/sync/upload -> 200   the same request retried once, same opIds
  The 401 is refused by the guard before any handler runs, so the ops reached the server once. The
  first pass of this proof counted HTTP attempts and called it "sent twice"; that line was wrong and
  is corrected in d183v2-verdict-corrected.txt.

FILES
  d183-README.txt                     this file
  d183-ENVIRONMENT.txt                tree, commits, what was started, which database
  d183-engine-regions-md5.txt         the DOS-183 engine regions are byte-identical at f23a9a7 and at HEAD
  d183v2-verdict-corrected.txt        THE RESULT — both runs, with the HTTP statuses
  d183-web-goes-first-v2.mjs          the prover that produced it (full op ids, addInitScript online
                                      listener, 150 s offline soak)
  d183v2-result.json / -events.json / -network.json   its raw output
  d183v2-office-check.txt             the office rows and sync_ops, read back from the lane database
  d183v2-side-observation-*.txt       what the page does on the wire with no signal (not a finding)
  d183v2-s1-*.png .. d183v2-s3-*.png  the screens, in order
  d183-web-goes-first.mjs + d183-result.json + d183-*.png   run 1 (same walk, no soak, order-id-level
                                      counting) — kept because it is an independent second measurement
  d183-run-attempt1-shop-not-on-this-phone.log + d183-attempt1-*.png
                                      the first attempt, which picked a shop from the office database
                                      instead of the device and got "That shop is not on this phone".
                                      Kept so the record shows what was run, including what failed.
  d183-all-in-one-3100.log / d183-metro-5185.log   the two servers this proof started and stopped
