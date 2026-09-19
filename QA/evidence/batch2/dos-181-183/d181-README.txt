# DOS-181 — "the delivery app's Record/Save button does nothing" — PROVED FIXED on a real device
Pixel_7_API_36, main at 71fa9c3, 2026-09-20 02:22–02:48 IST. Every file below was produced by the
run it names; nothing here is a reconstruction. Environment: d181-ENVIRONMENT.txt.

## The verdict in one line
Both presses DO something. Online, the office holds the delivery seconds later; offline, the phone
holds a row and one outbox op, and that op goes to the office exactly once when the signal returns.

---------------------------------------------------------------------------------------------------
## A. The refusal the finding mistook for a dead button — now decided BEFORE the press
File: d181-12-d4-jain.png / .xml   (SAI/0429, Jain Kirana Mart, credit, 444/444 on the bill)

    d4-record  "Record the delivery"  enabled=FALSE  bounds [42,2000][1038,2199]
    (plain Txt) "This shop is on credit — a photo is required before you can record it"
                                                     bounds [42,2210][1038,2306]

The screen is 1080x2400. The sentence sits at y=2210..2306 — ON the first viewport, under the
greyed button, with NO scrolling. That is the whole DOS-181 fix: the press that used to be accepted
and then refused a screen and a half below the thumb is now refused out loud before it is taken.

## B. ONLINE press — "Record the delivery"
Files: d181-24-d4-anand-online.{png,xml}  d181-25-online-01-before-press.png
       d181-25-online-02-after-press.png  d181-office-before-online-press.txt
       d181-office-after-online-press.txt

Bill SAI/0438 at Anand General Store (pays on delivery, so no photograph is asked for).
  before: d4-record enabled=TRUE label "Record the delivery", "Dropping 167 / 167", no refusal line
  pressed 2026-09-19T21:03:13.156Z (02:33:13 IST)
  +2.3 s the app left D4 for the stop screen (that is `record.onSuccess` -> router.replace)
  office, dos_test_b2_d181walk, read straight afterwards:
      deliveries d455b557… outcome = delivered, delivered_at 2026-09-20 02:33:13.459+05:30,
                            delivered_by 5530f7b6…, device_id 01a0bb5f…
      delivery_lines        4 rows, 48+75+11+33 = 167 pieces, none returned
      trip_stops 93867b58…  state = delivered
      deliveries for that invoice: 1  (no duplicate)
  Before the press the same row read outcome = NULL with 0 lines (d181-office-before-online-press.txt).

## C. OFFLINE press — "Save on this phone"
The office was cut the way the brief asks — not by airplane mode:
  d181-26-office-cut.txt: `adb reverse --remove tcp:3100` AND the all-in-one process stopped;
  the host refuses :3100 and the device cannot reach it. Metro (:8081) was left alone.
  The app noticed by itself: the strip read "Offline since 2:33 am" (d181-29-home-offline2.xml).

Files: d181-32-d4-jain-offline.xml (label flips to "Save on this phone", still disabled — credit)
       d181-39-d4-nothing-offline.xml ("Nothing from this bill" -> "Dropping 0 / 444" ->
                                        d4-record enabled=TRUE, still "Save on this phone")
       d181-43-offline-01-before-press.png / -02-after-press.png
       d181-44-phone-after-offline-press.txt   d181-45-queued-op-data.json

  pressed 2026-09-19T21:15:05.003Z (02:45:05 IST)
  +3.7 s the app left D4 for the stop screen and the strip read
        "Offline since 2:33 am · 1 waiting to send"   (d181-43-offline-02-after-press.png)
  the phone's own store (pulled with run-as, d181-db-after-offline-press2.db):
      _outbox seq 2  op_id 01a0bb85-d584-715b-875d-a9388f2eb257  tbl deliveries
                     row_id 77833c20…  op PUT  status queued  created_at 21:15:05.477Z
      deliveries 77833c20…  delivered_at 21:15:05.467Z, device_id set (outcome stays null by
                     design — the server derives the outcome)
      the op carries the WHOLE doorstep fact: 3 lines, 150+150+144 = 444 pieces returned,
                     reason "refused", plus the geo proof (d181-45-queued-op-data.json)

## D. It is sent ONCE when the signal returns
Files: d181-46-office-after-reconnect.txt  d181-47-sent-once.txt  d181-48-phone-after-reconnect.txt
       d181-all-in-one-3100-restart.log  d181-49-after-reconnect.{png,xml}

  office back at 21:16:12Z (service restarted, `adb reverse tcp:3100` restored)
  phone sent at  21:16:30.076Z, acked 21:16:30.735Z — ONE sent_at, the ORIGINAL op id kept
  office now:
      deliveries 77833c20…  outcome = failed, delivered_at 02:45:05.467 (the press, not the send),
                 idempotency_key = sync:delivery:01a0bb85-d584-715b-875d-a9388f2eb257
      delivery_lines  3 rows, 0 delivered, 444 returned
      sync_ops        EXACTLY 1 row for that op id, outcome {"ok": true}
      deliveries for that invoice: 1   (applied once, not twice)
  phone: _outbox seq 2 status = acked, _sync_errors = 0, strip back to "Updated just now",
         the stop chip now reads "Not delivered" — the outcome the office derived came back.
  The service log holds two POST /sync/upload since the restart: req-2 401 (the access token had
  expired while the office was down) then req-3 200 after one /auth/refresh. That is the api
  client's one transparent refresh, not a second send — sync_ops proves one application.

---------------------------------------------------------------------------------------------------
## The trap the brief warned about, met and worked around honestly
The FIRST offline press, at 21:11:55Z, did nothing: a LogBox banner ("Can't perform a React state
update on a component that hasn't mounted yet…") was drawn OVER the footer, and the tap opened the
LogBox panel instead of pressing the button (d181-40-offline-01-before-press.png shows the banner
sitting on the button; d181-41-01-logbox.png is the panel it opened). The phone store taken right
after held NO new outbox row (d181-db-after-offline-press.db). The banner was dismissed by its own
control and the press was repeated (section C) — and d181-step5-press.mjs now REFUSES to press while
any LogBox node is on screen, so this cannot be mistaken for a product failure again.

## Observations made while operating, NOT part of the verdict, NOT further tested
1. The system camera kills the app on this emulator (twice; d181-36-camera-kills-the-app.txt), so the
   photograph path — "photo attached -> d4-record enables -> press" — was NOT driven here. Everything
   else about the credit-shop gate WAS: the refusal is on screen (A) and the same gate releases the
   button the moment the outcome stops needing a photograph (d181-39).
2. While an offline doorstep write sits in the outbox, the stop screen still offers "Deliver this
   bill" for that bill (d181-43-offline-02-after-press.png, taken with "1 waiting to send" on the
   strip). `stop/[id]/index.tsx:97` counts a bill open while `outcome === null`, and the queued op
   does not carry an outcome, so the phone does not show back the write it is holding. Whether a
   second press would harm anything was NOT tested.
3. The queued op retried 8 times while the office was down (attempts=8 with no sent_at) — the same
   offline retry storm the DOS-183 lane already filed (d183v2-side-observation-offline-retry-storm.txt).
4. The app ANRs repeatedly during the first sync pass after a `pm clear` on this emulator; it settles
   once the pass is done. Recorded because it cost this walk ~20 minutes, not as a finding.

## Files, by kind
d181-lib.mjs                     the Appium harness (resource-id / text locators, ANR + LogBox handling)
d181-step1-signin.mjs            sign in
d181-step2-home.mjs              clear the system dialogs, wait for the first pass
d181-probe.mjs / d181-open.mjs / d181-scroll.mjs / d181-dismiss.mjs / d181-logbox.mjs   navigation and reading
d181-step3-photo.mjs / d181-step4-shutter.mjs    the camera attempt (see observation 1)
d181-step5-press.mjs             the press, with the LogBox guard
d181-pull-db.mjs                 copies the phone's SQLite store out with run-as and reads it
d181-*.png / *.xml               what was on the screen, and the a11y tree it was measured from
d181-db-*.db                     the phone's store at each stage
d181-run.log                     every step's own log, in order
