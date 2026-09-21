# lean-retailer-platform — the walk the lane was never allowed to take

Settle stage, 2026-09-21. Worktree `.claude/worktrees/b2-lean-retailer-platform`, branch
`qa/b2-lean-retailer-platform` at `01cd7de`. Every earlier stage of this lane was forbidden to start a
server, so two things were owed: a claim about `auth.memberships.summary` that nobody had been allowed
to MEASURE, and the DOS-102 walk on a phone. Both are settled below. Nothing here is reasoned from the
source: every line is a number a browser, a device or the service actually produced.

## What was started, and on which ports

| What | Where | Why |
| --- | --- | --- |
| Postgres `dos_test_b2_retailer_platform` | 127.0.0.1:5439 | dropped, recreated from `dos_test_batch2b_template`, `pnpm db:migrate`, `pnpm db:seed` (both exit 0) |
| `@dos/all-in-one` | **:3100** — `/auth /owner /manager /sales /warehouse /delivery /retailer /admin` | :3000–:3007 were already held by another lane, so the port rule's all-in-one process was used instead. `ALL_IN_ONE_PORT=3100`, keys from `pnpm auth:keygen` passed as env, `CORS_ORIGINS=http://localhost:5178,…` |
| `@dos/retailer-app` web | **:5178** (`expo start --web`) | `EXPO_PUBLIC_API_URL=http://127.0.0.1:3100/retailer`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3100/auth` |
| `@dos/retailer-app` native Metro | **:8081** | for the Pixel 7; `adb reverse tcp:8081 tcp:8081` and `tcp:3100 tcp:3100` |
| Pixel 7 (`emulator-5554`) | already running, started by another lane | NOT started and NOT killed by this stage. The debug APK already built in the main checkout was installed and pointed at this worktree's Metro, so no Gradle build was needed. |

Both dev servers were stopped before this file was written; the emulator was left as it was found, with
the app uninstalled and the two `adb reverse` entries removed.

Everything below was driven with Playwright's Chromium (`QA/tools/node_modules/playwright`, viewport set
exactly, `deviceScaleFactor: 2`) and with `adb` on the Pixel 7. Screenshots are in this directory.

---

## Debt (1) — "the home screen can STILL show ₹0.00 to a shop that owes lakhs"

**The claim is FALSE against this lane's HEAD.** It was true of the code the finding was written
against; commit `a1c1d63` (already on the branch when this stage began) fixed it, and this is the first
time anyone has been able to measure that. Two independent halves, both measured, plus a counterfactual.

### (a) The client heals a 401 on `auth.memberships.summary`

Signed in as `ramesh.gupta` at 1280×900, then armed exactly one 401 on that read — the server's own body,
`{"message":"Sign in to continue","error":"Unauthorized","statusCode":401}`, captured from
`curl … -H 'Authorization: Bearer <bogus>'` — and waited out the 60 s `staleTime` so coming back to Home
refetched it.

| | requests the browser actually made | refreshes | `r2-total` after |
| --- | --- | --- | --- |
| **HEAD (`01cd7de`)** | `GET /auth/memberships/summary → 401`, `POST /auth/refresh → 200`, `GET /auth/memberships/summary → 200` | 1 | `You owe ₹91,494.00 across 3 distributors` |
| **counterfactual** (predicate reverted to the pre-repair allow-list of four names read off `path[0]`) | `GET /auth/memberships/summary → 401` — and nothing else | **0** | (stale data kept) |

The counterfactual was a temporary edit to `frontend/libs/api-client/src/client.ts` restoring
`new Set(['me','sessions','revokeSession','changePassword']).has(path[0] ?? '')`; it was reverted
immediately and `git status --porcelain` is empty. It is the mutation test that makes the "false"
verdict mean something: the mechanism the finding names is real, and the deny-list is what removed it.

Screenshots: `lean-retailer-platform-webdesk-r2-heal-after-401.png`,
`lean-retailer-platform-webdesk-counterfactual-r2-heal-after-401.png`.

### (b) A summary the device did not read is not a money figure

Every request for the summary refused with a 401 from before sign-in — the cold case the finding
describes, where there is no earlier success to fall back on:

```
summary refusals served: 1
r2-total  : "What you owe across 3 distributors could not be read just now"
Tarsun    : "…You owe ₹35,843.00  Not read just now"      (that figure is the OPEN tenant's own
Sai       : "…You owe —  Not read just now"                receivables read, a different call)
Kalyan    : "…You owe —  Not read just now"
₹0.00 anywhere on the page: false
```

Measured at HEAD **and** with the counterfactual predicate in place: the screen is honest either way, so
even a summary that never heals can no longer be printed as a figure. Screenshots:
`…-webdesk-r2-summary-refused.png`, `…-webdesk-counterfactual-r2-summary-refused.png`.

### (c) The lane's own guards, run here

```
@dos/api-client   src/auth-retry.test.ts                              3 passed
@dos/retailer-app src/lib/dos-102-across-total.guard.test.ts          4 passed
@dos/retailer-app src/lib/dos-102-last-distributor-restart.guard.test.ts  3 passed
```

---

## Debt (2) — DOS-102 on a phone. **Settled.**

Pixel 7 (`Pixel_7_API_36`, 1080×2400), the retailer app running this worktree's bundle.

| Step | What the device showed (read out of `uiautomator dump`, not from a picture) |
| --- | --- |
| sign in as `ramesh.gupta` | header `Tarsun Enterprise`; `You owe ₹91,494.00 across 3 distributors`; Tarsun ₹35,843.00, Sai ₹26,470.00, Kalyan ₹29,181.00 + `A van is at your shop` |
| tap `r2-switch-sai-distributors` | header `Sai Distributors, Dombivli`; `You are looking at Sai Distributors, Dombivli` |
| `adb shell am force-stop in.distributionos.retailer` | `pidof` empty — the process really was gone |
| reopen | header `Sai Distributors, Dombivli`, open card Sai, **`You owe ₹91,494.00 across 3 distributors`** |
| **stronger:** sign out from the ⋯ sheet, then sign in again | lands in **Sai** again, total again `₹91,494.00` |

The last row is the one that can only come from `dos.lastTenantId` in the native store: a sign-out clears
the session, so nothing else remembers Sai. That is the exact mechanism the guard could only model under
Vitest (where `@dos/ui/platform` resolves to the web half). It is now measured on the shipped native
store.

Screenshots: `…-pixel7-r2-home.png`, `…-pixel7-r2-in-sai.png`, `…-pixel7-r2-after-force-stop.png`,
`…-pixel7-r2-landed-back-in-sai.png`, `…-pixel7-r2-kalyan-van.png`.

---

## The walks the architect's design names

### DOS-102 — one home for every distributor

Server first: `GET /auth/memberships/summary` as `ramesh.gupta` answers 3 584 300 + 2 647 000 +
2 918 100 paise = **9 149 400 paise**, and Kalyan carries `onTheWay: {stops:1, state:"arrived"}`.

| | web desk 1280×900 | web phone 390×844 | Pixel 7 |
| --- | --- | --- | --- |
| `r2-total` | `You owe ₹91,494.00 across 3 distributors` | same | same |
| Tarsun / Sai / Kalyan | ₹35,843.00 / ₹26,470.00 / ₹29,181.00 | same | same |
| Kalyan's van line | `A van is at your shop` (`r2-card-kalyan-agencies-coming`, 1042×18 at x 205) | present, 324×18 at x 33 | present |
| horizontal overflow | `innerW 1280, scrollW 1280, maxRight 1280` — none | `innerW 390, scrollW 390, maxRight 390` — none | — |

Last-used landing, measured on both widths: first sign-in opens Tarsun with
`dos.lastTenantId = 01a0999a…` (Tarsun); switching to Sai rewrites it to `82f5c562…`; signing **out**
leaves it at `82f5c562…`; signing in again opens `r2-card-sai-distributors`. Screenshots
`…-{webdesk,webphone}-r2-in-sai.png`, `…-r2-landed-back-in-sai.png`.

### DOS-103 — a shop can reach its distributor

`branding.phone` is **not** seeded (the design asked the demo seed to set it; it does not). It was set
through the real owner API for the three tenants — `POST /owner/tenancy/settings` as `sunil.tarsun`,
`prakash.salunkhe`, `nitin.bhoir` — which is what the owner's Settings screen calls.

- R2 then shows `Call <name>` and `WhatsApp` on the card of the distributor that is **open**, and only
  that one (1042×69 each at x 205 on desk). The other cards have no `-call` node. That follows from the
  design: `tenancy.branding.get` is scoped by the token, so the app does not know the other offices'
  numbers. Not a defect — worth writing down so nobody re-reports it.
- Web hand-off, measured by hooking `window.open`: `Call` → `window.open("tel:+919820813844")`.
  `WhatsApp` → the pop-up is refused for the second call and `links.web.ts` falls back to
  `location.href`, so the tab itself navigates to
  `https://api.whatsapp.com/send/?phone=919820813844&…`. Both reach the right number.
- **Pixel 7**: tapping `Call Sai Distributors, Dombivli` brings
  `com.google.android.dialer/…MainActivity` to the front with **`+91 98331 12255`** on the keypad — the
  number the owner had just set for Sai. `…-pixel7-call-handoff.png`.
- R4 → `Report a problem with this bill` → Returns opens with the bill already carried
  (`rt-ask` meta reads *"This is about the bill you came from"*, kind `Take goods back` preselected).
  The BODY is not pre-filled and `rt-ask-send` stays disabled until the shop types — correct: the design
  stores the words exactly as typed.
- Filed a report; `POST /retailer/notifications/inbound → 200`. The manager (`vikas.kadam`) sees it in
  `GET /manager/notifications/inbound` as
  `{channel:"in_app", kind:"return_request", refType:"invoice", refId:"089d9946…",
  retailerName:"Shree Ganesh Kirana", fromPhone:"+919892000001", handled:false}`.
  After `POST /manager/notifications/inbound/{id}/handled`, the shop's own phone shows it under
  YOUR REQUESTS as **`Seen by Tarsun Enterprise`** · `Take goods back · 21 Sep, 4:32 am`.
  `…-pixel7-rt-mine-seen.png`, `…-webdesk-rt-sent.png`.
  (The desk's own M18 screen was not opened — the manager app was not started. The queue was read
  through manager-service, which is what that screen reads.)

### DOS-104 — the price list is one slim read

Opening R7, measured from the browser's own network log:

```
GET /retailer/tenant-catalog/products?limit=200&listedOnly=true   200   114 661 B
GET /retailer/inventory/availability?limit=500                    200    11 459 B
GET /retailer/pricing/rates?retailerId=…                          200    18 063 B
pricing/rates GETs: 1      pricing/quote POSTs: 0      …/sellable: 0
```

171 catalogue rows, **171 of them printing a per-piece rate** (first row: *Chamak Detergent Bar 250 g ·
48 pc case · MRP ₹20.00 · In stock · ₹14.24 per piece + GST*). 18 063 B is under the design's 20 KB.
Pressing `+` on one row then fires **exactly one** `POST /retailer/pricing/quote → 200 (627 B)` and the
basket appears: *Before offers ₹683.52 · Before GST ₹683.52 · GST ₹123.03 · Rounding ₹0.45 · You pay
₹807.00*. Identical shape on the Pixel 7, read from the service's own request log while the screen
opened: `/tenant-catalog/products ×1, /inventory/availability ×1, /pricing/rates ×1, /pricing/quote ×0`.
`…-{webdesk,webphone,pixel7}-r7-order.png`, `…-webdesk-r7-basket.png`.

### DOS-125 — a QR a shop can actually scan

The QR was **decoded** out of the screenshots with jsQR (`frontend/node_modules/jsqr`), so this is what a
UPI app's scanner would read, not what the page claims:

| screenshot | decoded |
| --- | --- |
| `…-pixel7-r3-qr-sheet.png` (1080×2400) | `upi://pay?pa=saidistributors%40okhdfcbank&pn=Sai%20Distributors%2C%20Dombivli&am=1161.00&tr=SAI-0081&cu=INR` |
| `…-webdesk-r3-qr-sheet.png` | `upi://pay?pa=tarsun%40okhdfcbank&pn=Tarsun%20Enterprise&am=4561.00&tr=INV-0433&cu=INR` |
| `…-webphone-r3-qr-sheet.png` | identical to the desk one |
| `…-webphone-r5-pay.png` | `upi://pay?pa=tarsun%40okhdfcbank&pn=Tarsun%20Enterprise&am=35843.00&tr=PAY-084f1e16f0d3&tn=PAY-084f1e16f0d3&cu=INR` |

Each decodes to exactly the string printed under it, with the distributor's VPA and the amount.

Wrapping at 390, measured: `r3-qr-payload` is 18 px tall at 1280 and **36 px** (two lines) at 390;
`r5-intent-string` 18 px → **54 px** (three lines); both end at x = 374 inside a 390 px viewport, and
`scrollW == innerW == 390` on every screen — no horizontal overflow anywhere. `r5-web-hint` is visible
at both widths (1076×22 desk, 358×66 phone). QR image 216×216 on both.

`Copy` on `http://localhost`: clicked `r5-copy`, then read `navigator.clipboard.readText()` back —
**byte-for-byte equal** to the intent on screen. On the Pixel 7 the sheet carries `r3-qr-sheet`,
`r3-qr-image`, `r3-qr-payload`, `r3-qr-pay` and **no `r3-qr-copy`**, which is what the design specifies
(`clipboard.native.available === false`).

### DOS-100 — no walk, deliberately

Commit `6ab3ef7` took the half-built hold screen back out of this lane and put DOS-100 back on the shelf
for the lane that owns `orders.internals.ts`. There is no `r8-hold` panel and no `order_on_hold`
template on this branch, so there is nothing here to walk. Confirmed by grep on the branch, not assumed.

---

## Still not proven

1. **iOS — not proven, not attempted beyond checking whether it was possible.** There is no iOS build
   product for the retailer app anywhere on this Mac (no DerivedData for it, no `.app` in any simulator),
   so it would need a fresh CocoaPods + Xcode build. At the time of the walk the machine had **40 MB of
   RAM unused and 6.07 GB of its 7.17 GB swap already in use**, shared with other lanes; booting a
   simulator and an Appium/WDA stack on top of that would have put the other lanes at risk. Expo Go
   57.0.9 *is* installed on two simulators, but `xcrun simctl` alone cannot tap or type, and CLAUDE.md
   forbids opening the simulator panel. Android was walked instead — same native renderer, same
   `storage.native.ts` — which is evidence about the mechanism, not about iOS.
2. **The owner's Settings screen and the manager's M18 screen were not opened.** `branding.phone` was
   set and the inbound queue was read/handled through owner-service and manager-service, the same calls
   those screens make, but neither app was started (memory).
3. **A real UPI app has not scanned the QR.** jsQR decoding the rendered pixels is as close as this
   machine gets.
4. The smoke gate was not this lane's debt and was not run here.

## Two things noticed in passing, neither a defect of this lane

- In **all-in-one** mode the app's `absoluteUrl()` builds logo URLs from `API_URL` without the service
  prefix, so `/storage/tenant/…/logo.jpg` 404s at `:3100/storage/…` while `:3100/retailer/storage/…`
  answers 200. Working around it by putting the prefix in `EXPO_PUBLIC_API_URL` is what this walk did.
  `src/config.ts` is not this lane's file.
- On the phone the sticky bottom action bar (`Pay now` / `Order again`) sits over the last card's
  buttons, so `r2-switch-*` and `r2-card-*-call` have to be scrolled clear before they can be tapped.
  Pre-existing shell behaviour, not introduced here.
