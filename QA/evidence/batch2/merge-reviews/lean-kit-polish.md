# Merge review — lean-kit-polish (DOS-122, DOS-069, DOS-150)

Branch `qa/b2-lean-kit-polish`, 3 commits (323f4d8, 31c33a1, 35d2ded) on main tip `4d57a04` (zero drift). Reviewer: Fable, 2026-09-20. Read-only.

**Decision:** MERGE — no code change required. The three findings stay OPEN (merged, proof owed) until the walks below pass; the group notes required device proof that this lane could not run.

## Fix vs design and product rules

- **DOS-122** `web/feedback.tsx:311-353`: `stacked = theme.touch !== 'desk'`; row → `column-reverse`, both Buttons drop the hard-coded `size="desk"` so `<Button>` (`web/controls.tsx:37-56`) takes `theme.touch` and goes `width:100%`. Exactly the design ("keyed on theme.touch because the SSR snapshot is desk"). Confirm ends up ABOVE Cancel, matching the native DialogPanel (`native/feedback.tsx:381-392`), without moving Cancel's DOM/tab position; focus still lands on the confirm. Designed consequence worth knowing: `buildTheme` (`theme.tsx:101`) keeps `floor`/`field` on a desk viewport, so the warehouse/sales/delivery WEB apps at ≥1024 px now also get a stacked 76/69 px pair — consistent with every other button in those apps, but the notes said "below 1024 px"; see Walks.
- **DOS-069** `native/money.tsx:328-343, 464-478`: a second `SafeAreaProvider` inside the pad `Modal` plus `PadInsets` applying `paddingTop: insets.top`. Not moved into the DOS-164 overlay stack (guard `native-overlays.test.ts` still satisfied; the pad Modal is bound to `padOpen`, not an overlay's `open`). `react-native-safe-area-context` is already a dep + peer of `@dos/ui` (`package.json:50,129`, catalog 5.7.0) and of every app: no new dependency. The other seven `<NumberPad>` hosts (warehouse pack/pick/load/check-in/inbound/counts, manager gate) render inline on a `Screen`, not in a Modal, so the scope is right. Only the TOP inset is applied — see Minors.
- **DOS-150** `native/money.tsx:91-108` + `strings.ts:31-35`: the null branch now carries an explicit `accessibilityLabel={theme.t('money.notEntered')}` ('Not entered'); `Txt` forwards it (`native/base.tsx:68`). Same shape as the merged DOS-158 (`native/controls.tsx:82-92`). `catalogs = { en, hi: en, mr: en }` so no locale table to sync. Note the finding's Expected was "Amount taken, not entered"; TalkBack will read the sibling label Txt then "Not entered" — acceptable for P3.

No types.ts, contract, logic or money change. Five files touched, all five in this group's Owns. Nothing leaked.

## Tests

- DOS-122 (`web/render.test.tsx:1012-1057`): a real `renderToStaticMarkup` through `ThemeContextProvider`; fails on main (no literal `flex-direction`, `height:32px` on every viewport). Three cases cover desk-app/desk, floor-app/phone (76), desk-app/phone (63). Not weakened. Width (`width:100%`) is not asserted — it comes from `<Button>`, which is unowned and unchanged; the 390 px web walk covers it.
- DOS-069/DOS-150 (`money.test.ts:23-38, 242-306`): source-reading specs, the DOS-158 `parity.test.ts` precedent. They fail on main (no provider import, no `<SafeAreaProvider>` in the Modal region, no label on the null branch, no string) and pin the fix text, but they prove the SOURCE, not the device behaviour — in particular NOT that a nested provider gets a real `onInsetsChange` inside an RN Modal window on API 36 edge-to-edge, which is the one thing the group notes asked to check. Device proof is owed, not optional.
- Verifier reproduced package-green (24 files). Implementer's "328 tests in money.test.ts" is a wording slip (package total), not a claim the merge rests on.

## Blockers

None.

## Minors (no code change required before merge)

1. `native/money.tsx:341` applies `paddingTop` only. On API 35+ the Modal window is edge-to-edge at the bottom too; the Done/Clear row is not pinned to the bottom (`NumberPad` is a top-stacked column), so on a Pixel 7 it should clear the gesture bar — the Android walk must show the row and, once, 3-button nav. If it does not, add `paddingBottom: insets.bottom` to `PadInsets` — one line, same file.
2. The nested provider starts from the parent's insets (same first-window values) then re-measures; no flash expected, but the Android/iOS screenshots must be taken AFTER the slide animation, not on the first frame.
3. `money.test.ts` regexes (`/paddingTop:\s*insets\.top/`, `'<SafeAreaProvider>'`) will break on an innocent refactor (e.g. `paddingTop: top` after destructuring). Accepted for now as the workspace has no native render harness; a native harness should replace both source-reading specs.

## Conflicts

- With main now: none — branch is on main's tip `4d57a04`; `git merge-tree` is clean.
- With unmerged branches (`lean-admin-support`, `lean-delivery-collect`, `lean-manager-money`, `lean-sales-rep`, `lean-warehouse-pick`): none touch the five changed files.
- With unbuilt wave-3 groups: no other group's Owns lists `strings.ts`, `web/feedback.tsx`, `web/render.test.tsx` or `money.test.ts`; `native/money.tsx` was also owned by `lean-sales-entry` and `lean-retailer-shop`, both already merged (their edits are in the base). `lean-warehouse-rules` touches warehouse screens (walk-only here). Nothing to rebase.

## Walks still owed (all three platforms, per the group notes)

- **Web 390x844** (the DOS-122 measurement the notes required and this lane did not produce): warehouse `load/[id].tsx` "Check out MH-05-BQ-4471?" → Cancel and 'Send the vehicle out' stacked, full width, 76 px, confirm above Cancel, focus on confirm; owner web at 390 → 63 px stacked; owner web at 1280 → the 32 px pair unchanged; warehouse web at 1280 → now 76 px stacked (record it as the designed consequence, or raise it if the desk-viewport warehouse dialog looks wrong).
- **Android Pixel_7_API_36 (-memory 3072)**: delivery `ganesh.more` → stop → Take money → Amount taken: screenshot with the title BELOW the status bar clock (DOS-069, a-17/a-18 re-shot) and the Done/Clear row above the gesture bar; uiautomator dump after 4 7 5 6, Clear, Done: the '—' node's content-desc reads "Not entered" (DOS-150, delivery-060-08 re-dump).
- **iOS simulator (simctl, headless)**: the same pad on an iPhone with a notch — title below the notch; one screenshot.

## Defects outside this group

- `frontend/libs/ui/src/web/money.tsx:88-96` — the WEB `<Money>` null branch has no `aria-label` while both non-null branches set one (`:105`, `:122`); a screen reader reads the em dash or nothing, the same class as DOS-150 on the DOM renderer. One-line fix: `aria-label={theme.t('money.notEntered')}` on the span, now that the string exists. File as a P3 kit finding (web parity of DOS-150).
