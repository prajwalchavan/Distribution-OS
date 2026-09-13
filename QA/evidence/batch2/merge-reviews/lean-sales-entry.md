# Merge review — lean-sales-entry (qa/b2-lean-sales-entry, 6 commits, 10 files, +680/−103)

Architect: Fable · 2026-09-13 · read-only review of `git diff main...qa/b2-lean-sales-entry`. No design verdict existed for this group (none was required).

**Decision:** MERGE AFTER FIXES

## Fit to the findings and the group notes
- DOS-128 / DOS-147: `SuggestionRow` reads `useViewport()`; off desk the availability folds into the meta line (`brand · N pc case · N cs`, 2 lines) and the trailing row keeps only "Add a case"; desk unchanged. Matches the note. Source spec added.
- DOS-161: header chips (`orderChips`) render once, pinned at desk and inside the scroll off desk; phone footer is one `Row` (`s3.summaryCompact` + button). Kit `native/layout.tsx` untouched, as required. Source spec added.
- DOS-129: `summarizeCases` / `formatCaseSummary` under `sales-app/src/lib/pricing.ts` (vitest `--dir src`), each line in its own case size; `caseSizeOf` removed; 4 unit tests match the test plan.
- DOS-085: kit `QtyStepper` (web + native) gains `caseStepNeedsConfirm` + a `Dialog` before "one case less" wipes loose pieces; `stepPiece` added; the pieces pad is the app's own `PiecesSheet` (`parsePieces`, `keyboard="decimal"`, ±1) committing through `setQty(..., 'piece', ...)` so `entered_unit` stays honest (docs/17 A3). `QtyStepperProps` unchanged, credit-notes untouched. Right call: the kit's single `onChange(pieces)` cannot label the unit.
- DOS-082: `diffQuoteVsOrder(quote.result.lines, created.item.lines)` compares `PricedLine.ratePaise` (override/tier, then approved bargain) with `OrderLine.ratePaise`, which the server writes from the same engine — like with like; free goods stay on the same line (`freeQtyPcs`), so no duplicate-variant false positive. No re-pricing, no contract change (DOS-126 rule kept). Shown after placing in the "Order placed" panel; the finding accepts "at least after placing". `useMutation` reads the run through a ref, so the captured `quote` is the current render's.
- Kit exports verified: `parsePieces`/`stepPiece` via `shared.ts`, `useViewport` via both renderer indexes, `Dialog` in both `feedback.tsx`; `DialogProps` has every prop used; `hi`/`mr` alias `en`, so new keys cannot break typecheck. Native overlay stack renders a Dialog inside an open Sheet as a layer (retailer R7, sales drafts, gate).

## Blockers
1. **Phone footer squeezes the money figure (web) or the button (native)** — `frontend/sales-app/app/orders/new.tsx` phone `bottomBar`: the new one-row `Row` has no `wrap`, and the kit `Button` is full-width by default off desk (`web/controls.tsx:42,56` → `width:100%`; `native/controls.tsx:77` → `width:'100%', flexShrink:1, minWidth:0`). In a non-wrapping flex row the button's basis is the whole row, so on the web at 390 px the flex-shrink split leaves the clamped `Txt` (`overflow:hidden`, min-width 0) about 130 px — "Items 2 · ₹1,87…" — the very number the rep reads across the counter; on native the `Text` (flexShrink 0) wins and "Place order" is squeezed instead. Fix: `fullWidth={false}` on the phone button and wrap the summary `Txt` in `<Box grow>` (or give it `style={{ flexShrink: 1, minWidth: 0 }}`), then measure at 390×844 web and on the Pixel 7 / iPhone.

## Minors (not blocking)
- `qty.removeBody` says "Remove it from the order?" but reaches every stepper: manager pack (`fulfilment/pack.tsx:259`, a pick count) and the gate received count. Neutral copy ("Set it to zero?") or a per-caller body later (lean-kit-polish owns `ui/strings.ts`).
- Off desk the `available === 0` row loses its `brick` chip: "0 cs" now sits in secondary grey on the meta line. Keep the chip when `available === 0` (it is short) or colour the meta part; the stock chip's out-of-stock signal (DOS-074/097) should survive on the phone.
- The phone footer drops the case count entirely, so DOS-129 is fixed on desk and moot on the phone. Consider `formatCaseSummary` in the phone `orderChips` line ("2 items · 3 cs") so the read-back number exists somewhere off desk.
- `PiecesSheet` uses `autoFocus` inside a `Sheet`; credit-notes does not. On Android the keyboard may not rise on the first open — check on the walk.
- DOS-082 stays silent for a queued (offline) order that is re-priced when it lands; that is DOS-083/DOS-079 territory, out of this group by the note.
- `frontend/libs/ui/src/strings.ts` and `sales-app/src/lib/pricing.test.ts` are edited/added without being in `ownsFiles`; harmless now (see Conflicts).

## Conflicts with main
None: no file of the branch changed on main since the merge base (53daedb; lean-kit-overlays, h13-owner-support, docs/22 landed on other files). No in-flight `qa/b2-*` branch touches these files. Groups that wait for this one and must rebase after it lands: lean-retailer-shop (`native/money.tsx`), lean-kit-polish (`native/money.tsx`, `ui/strings.ts`), lean-sales-rep and lean-sales-orders-pricing (`new.tsx`, `sales-app/src/strings.ts`, `qty.ts`, `pricing.ts`). The kit stepper confirm dialog reaches delivery D4/van sale and manager M20 as the note foresaw; the piece pad does not (app-level).

## READMEs
None change: no contract edit, `pnpm docs:readme:check` is unaffected.

## Walks still owed (nothing in this group was walked by the builder or the repair session)
- Web 390×844 and 1280: catalog rows (name column ≥ ~150 px, meta unclipped), the fixed phone footer (money readable, button whole), DOS-129 mixed case sizes on desk.
- Pixel 7: catalog rows with the "N cs available" chip, PiecesSheet (type 18 at a 24-pc case → line ships 18 pc, ± buttons, keyboard on open), "one case less" at 0 cs opens the dialog and Cancel keeps the pieces.
- iPhone 16 Pro via `xcrun simctl` + `QA/tools/ios-drive.mjs`: scroll window well over 267 pt, 19 taps on "One case more" = 19 cs, stepper never under the footer.
- DOS-082: change a Tier C rate mid-draft against a live backend; the placed panel names "Neelam Neem Soap 100 g 26.08 → 27.50".
- Once on web: delivery D4 / van sale and manager M20 / credit notes steppers still step, and the new dialog reads sensibly there.

## Defects outside the group
- `frontend/libs/ui/src/web/controls.tsx:42` — a kit `Button` defaults to `width:100%` off desk with no `flexShrink:0`, so any non-wrapping `Row` that pairs it with text divides the row by flex basis; the same trap SuggestionRow already dodges with `fullWidth={false}`. A `Row` should probably not stretch a child button by default (kit question for lean-kit-polish).
