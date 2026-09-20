# lean-warehouse-pick — the walk the lane owed (DOS-118 residual, with DOS-165 / DOS-051 in the same sheet)

Date 2026-09-21 (IST). Worktree `.claude/worktrees/b2-lean-warehouse-pick`, branch `qa/b2-lean-warehouse-pick`
at `4aec428` (merge base with main `b8b116d`). Database `dos_test_b2_warehouse_pick`, recreated from
`dos_test_batch2b_template`, `pnpm db:migrate` + `pnpm db:seed`.

The debt: DOS-118's residual was **mitigated but never measured** — every earlier stage of this lane was
forbidden to start a server, an emulator or a simulator. Nothing below is inferred from source; every
number is read off a rendered screen.

## What I started, and on which ports

| what | port / device | note |
| --- | --- | --- |
| `@dos/all-in-one` (all eight services + `/auth`) | **:3100** | `:3000–:3007` were held by other lanes; nothing of theirs was touched |
| `@dos/warehouse-app` web (`expo start --web`) | **:5176** | `EXPO_PUBLIC_API_URL=http://127.0.0.1:3100`, `EXPO_PUBLIC_API_PREFIX=/warehouse`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3100/auth` |
| Metro (native bundler, same app) | **:8081** | `adb reverse` 8081 and 3100 |
| Appium (mine) | **:4733** | `:4723` / `:4725` belong to other lanes and were left alone |
| Pixel 7 emulator `Pixel_7_API_36` | already booted by another lane (`-memory 3072`), **idle on the launcher** | I did not start it and did not kill it; the installed dev build `in.distributionos.warehouse` was pointed at MY Metro, and the device was returned to the launcher afterwards |
| iOS simulator iPhone 16 Pro, iOS 18.0 | booted headlessly by me (`xcrun simctl`), Expo Go 57.0.9 | no Simulator panel was opened; shut down at the end |

Sign-in everywhere: `dinesh.patil` / `Dos@1234`. Wave **PICK-0078** (`picking`, 13 lines still open).

## Walk 1 — web desk 1280 × 800 (Chromium, DPR 2)

Lot row "Sunbake Salted Cracker 200 g", ask **13 pc**; Short pressed, `2` `0` keyed (20 of 13).

* Sheet scroll box: `y 160 → 800`, **client height 640 px**; content **1152 px** → **512 px of overflow**.
  At 1280 × 800 this sheet now scrolls; DOS-118 recorded that at the desk "the same line is fully
  visible", which is no longer true.
* On open (`scrollTop 0`): heading `y 280–302`, the three reason rows `y 318–548`, the refusal line
  `y 580–602` — all visible. The pad's own button is at `y 1196–1272`, i.e. **396 px below the
  viewport**: the keypad cannot be used without scrolling.
* At the pad (`scrollTop 512`, the bottom): the over-ask sentence sits at `y 68–90`, **70 px above the
  scroll box's top edge** → clipped, not painted (`document.elementFromPoint` at its centre returns the
  sheet container, not the text). The button at `y 684–760` reads **"Too many pieces"**: text 123 px
  wide in a 1216 px button, `white-space: nowrap`, one line, **not truncated**.
* Pressing that button changes nothing on screen (`w5-short-sheet` still open, identical screenshot).
* Sweep of every scroll position 0…512: the sentence is fully visible **up to 420**, the button from
  **472** — **no position shows both**; at 420 only **24 px of the 76 px button** is on screen.

Screenshots: `lean-warehouse-pick-webdesk-short-open.png`, `-short-noreason.png`, `-short-overask.png`,
`-short-after-press.png` (the last two are byte-identical — that is the "pressing Short does nothing" of
DOS-118, now with the label as the only answer).

## Walk 2 — web phone 390 × 844

* Scroll box `y 169 → 844`, **client 675 px**; content **1174 px** → **499 px of overflow**.
* On open: reasons `y 327–557`, refusal `y 589–633` visible; the pad's button at `y 1227–1303`,
  **383 px below the fold**.
* At the pad (`scrollTop 499`): the over-ask sentence at `y 90–134` — **79 px above the box**, clipped.
  Button `y 728–804` (exactly where DOS-118 measured the old Short button) reads **"Too many pieces"**,
  123 px of text in a **326 px** button, one line, not truncated.
* Sweep 0…499: sentence whole up to **420**, button whole from **459**, **0 positions with both**; at 420
  only **37 px of 76** of the button shows. At the bottom the sentence's baseline is **35 px** above the box.
* The missing-reason refusal behaves the same way: label "Choose a reason" on the button, sentence above
  the pad.

Screenshots: `lean-warehouse-pick-webphone-short-open.png`, `-short-noreason.png`, `-short-overask.png`,
`-short-after-press.png`.

## Walk 3 — Pixel 7 (Android 16, 1080 × 2400 px @ density 420 → **411.4 × 914.3 dp**)

Dev build `in.distributionos.warehouse` on my Metro. Lot row "Godavari Table Butter 500 g", ask **220 pc**;
`9` `9` `9` keyed (999 of 220). Bounds from `uiautomator dump`, converted at 2.625 px/dp.

* On open: heading `198.5–220.6 dp`, reasons `237.7–313.5`, `313.5–389.7`, `389.7–465.5` (each a
  full-width 76 dp row, all three fully readable), refusal `498.3–542.5`, "Requested 220 pc" `601.1–619.4`,
  value at `665.5`, keys `1–3` at `733.7`. Keys `7–9`, `Clear/0/⌫` and the button are below the fold.
* At the pad (after two swipes, the bottom of the sheet): the refusal node is clamped to
  `top 198.5 / bottom 103.6` — **entirely above the ScrollView**, and so is "Requested 220 pc"
  (`bottom 180.6`). The screenshot shows only the top sliver of the "220" glyphs.
  **On the godown's own device the picker sees the count 999 and no ask at all.**
* The button `699–775.2 dp` (76 dp, full width 347 dp) reads **"Too many pieces"**, label
  `145.1–266.3 dp` = **121 dp on one line**, not truncated, not wrapped.
* Tapping it changes nothing: same hierarchy, same label, no toast, sheet stays.

Screenshots: `lean-warehouse-pick-pixel7-short-open.png`, `lean-warehouse-pick-pixel7-short-overask.png`.

## Walk 4 — iOS, iPhone 16 Pro simulator, iOS 18.0, Expo Go (**402 × 874 pt**)

Driven headlessly through my own Appium on :4733; screenshots via `xcrun simctl io booted screenshot`.
The sheet's children are collapsed into one accessibility element on iOS (the Modal merges them), so
rects come from the pixels instead: a PNG decoder measuring the brick-red refusal colour `#9E1C1C` and
the primary button fill `#14585C`.

* On open: all three reasons render on their own full-width rows and **all three words are whole** —
  "Not on the rack", "Damaged carton", "Batch held back". This is the exact device and width where
  DOS-165 saw the third chip cut to "Batcl" at `x 331–487`; it is gone. No reason is preselected (DOS-051).
  The refusal sentence is on screen: red pixels at `pt 16.7–378 × 497.7–531`.
* At the pad with 999 of 220 keyed: **zero pixels of `#9E1C1C` anywhere on the screen** — the sentence is
  not visible in any form. The primary button occupies `pt 32–369.7 × 658–733.7` (337.7 × 75.7 pt) and its
  white label "Too many pieces" occupies `pt 138–264 × 690–704.7` — **126 pt, one line, untruncated**.

Screenshots: `lean-warehouse-pick-ios-short-open.png`, `lean-warehouse-pick-ios-short-overask.png`.

## Walk 5 — the allowed Short still saves (390 × 844)

On open none of the three reasons is selected (all `rgb(255,255,255)`, none `selected`) — DOS-051 holds on
the web too. Choosing "Damaged carton" and keying `5` against an ask of 13 turns the button back into
**"Short"**; pressing it closes the sheet, and the server row reads
`picked_qty_pcs 5, short_reason 'Damaged carton', picked_at set` for pick line
`f2eb3097-a55c-7e04-85ec-46c099322392`. The picker's own word, not a default.
Screenshot: `lean-warehouse-pick-webphone-short-saved.png`.

## Verdict

**Proven** (this was the merge review's actual doubt): the `doneLabel` mitigation is real and legible
wherever the button is — 123 px in 326 px at 390, 121 dp in 347 dp on the Pixel 7, 126 pt in 337.7 pt on
the iPhone 16 Pro at 402 pt, 123 px in 1216 px at the desk. One line, no truncation, no wrap, on all four.
The label flips to "Too many pieces" / "Choose a reason" the moment the save would be refused — before the
press, not after it — and flips back to "Short" when the save is allowed.

**Not fixed, and now measured**: DOS-118's own mechanism is untouched. On all four viewports the sentence
that carries the figure is off the visible box at every scroll position where the button can be pressed —
70 px above it at the desk, 79 px at 390, clipped on the Pixel 7 and on iOS — and a sweep of every scroll
position at both web widths finds **no position where both are fully visible** (best case: 37 of 76 px of
the button while the sentence is whole). The sheet is 1.7× its own scroll box: at the desk the keypad
alone measures 670 px, and heading + three reason rows + refusal add 296 px, against a 640 px box.
So the lane's own claim — "whatever part of the sheet the picker can see, one of the two is in it" — is
true, but the stronger reading of DOS-118's acceptance, the *sentence* next to the figure, is false on
every platform.

**Worse than before, as the review suspected**: the DOS-165 fix cost roughly 154 px of sheet height
(three 76 px rows plus the heading where one segmented row stood — arithmetic on the measured 230 px
reason group, not a second measurement of the old build), and the desk, which DOS-118 recorded as
unaffected, now scrolls 512 px too.

**New, from this walk**: on the Pixel 7 — the godown's actual device — the "Requested 220 pc" line is
clipped as well at the pad, so the only thing a picker has is the keyed count and three words. The web
phone still shows the ask; Android does not.

## What is still not proven

* Whether "Too many pieces" is *enough* for a picker who cannot see the ask on the Pixel 7 is a judgement
  I did not make and did not change. The one repair available inside this lane's files without touching
  the kit is to put the figure in the label itself (`w5.shortOverAsk` → e.g. "Only 220 pc asked", 17
  characters, which by these measurements fits: 15 characters render 121–126 dp/pt in a 337–347 dp/pt
  button). I did not make that change: the finding's acceptance is met by its own "or the Short button"
  branch, and rewording a refusal is the founder's call, not mine.
* Making the sentence itself co-visible with the button is not achievable in this lane: the 76 dp floor
  keypad plus its value line is 670 px on its own, so nothing short of shrinking a kit component (another
  lane's file) fits the sheet into a phone without scrolling.
* No iOS *dev build* was walked — Expo Go only, as everywhere else in this programme.
* The lane's other findings (DOS-047, DOS-119, DOS-120) were not re-walked: they were not what this stage
  owed, and no server was available to the stages that landed them either.

Everything this stage started was stopped afterwards; the Pixel 7 was left on its launcher, and the
emulator, the other lanes' Appium servers and ports :3000–:3007 were not touched.
