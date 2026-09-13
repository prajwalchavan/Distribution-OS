# Group lean-kit-overlays — architect merge review (Fable, 2026-09-13)
**Decision:** MERGE AFTER FIXES

Range 53daedb..d6977fa, five commits, six files, all inside the owned set (native/controls.tsx, native/feedback.tsx, native/list.tsx, parity.test.ts, platform/documents.native.ts + .test.ts). No types.ts, contract, permissions, schema, screen or web/ change; the DOS-164 host is intact (`visible={overlay.role === 'root' && overlay.presented}`, panels edited inside `SheetPanel` only, native-overlays guard untouched). Money, ledgers, state machines: not in play. No device walk was run for any item — the group note requires one, and blocker 1 is exactly what a first screenshot would have shown.

Per item: DOS-157 (6b4aee5) right — list.tsx:181 renders a non-string `secondary` as a node; web/list.tsx:181 already wraps a node in a `div` Txt, so parity holds. DOS-158 (d6977fa) right — controls.tsx:91-92, the label equals the visible text (`successLabel ?? label`, :118) and `busy` is present only while loading; web keeps `aria-busy={loading}`. DOS-162 (23d33c8) right — the JS message is Expo's `debugDescription` in every build (`toNSError`, expo-modules-core Utilities.swift:20-25), so `includes('PrintIncompleteException')` holds in release too; `Promise<void>` kept. DOS-152 (4af2565) right as far as it goes (Close is the last row of the ScrollView, nothing can be laid out behind it). DOS-159 (bf47ebd) is wrong in geometry — blocker 1.

## Blockers (fix, then walk, then merge)
1. **bf47ebd wraps the panel in a content-sized `KeyboardAvoidingView` (feedback.tsx:223-236: `style={{ width: '100%' }}`, no flex) between the flex-end backdrop and the `maxHeight: '86%'` panel.** Two consequences, both on every native Sheet, both platforms:
   (a) Yoga resolves the panel's 86% against the KAV's available inner height in BOTH passes: the measure pass (AtMost, screen H) clamps the panel at 0.86·H and sizes the KAV to min(content, 0.86·H); the final pass lays the KAV out Exactly at that size and re-resolves 86% against it. Every Sheet ends at 86% of its own content height: a body that used to fit now scrolls, and a scrim gap of ~14% of the sheet opens under the panel — a tap there hits the backdrop and closes the sheet, the DOS-152 harm moved one row down (More sheet, tenant switcher, W5 Short, W8 adjust, Record a payment, credit note, all of them).
   (b) Android `behavior="height"`: RN 0.86.3 KeyboardAvoidingView.js:244-247 sets `height: initialFrameHeight − overlap, flex: 0` on the KAV itself. A box the backdrop pins to the bottom only gets shorter in place and cannot rise; if the sheet is shorter than Gboard the height goes ≤ 0 and the panel vanishes while typing. The comment "Android already resizes the window" (:219-221) contradicts the finding it fixes: ReactModalHostView.kt:332 asks ADJUST_RESIZE, :395 makes the dialog window edge-to-edge (API 35+ ignores the resize there) and nothing applies `ime()` insets — that is why DOS-159's sheet stayed under the keyboard. So the Android branch is inert at best and a regression at worst; never the fix.
   **Fix:** KAV `style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none"` (definite height, so 86% resolves against the screen in both passes and the padding shrinks it when the keyboard is up; box-none keeps a scrim tap closing), backdrop keeps `flex: 1` + colour only, `behavior="padding"` on BOTH platforms (drop `Platform`), fix the two comment blocks, and update parity.test.ts:308-310 (import set) and :359-370 (the behavior string). Then the walks below, before merge.

## Minors (may follow)
1. DOS-162: expo-print Android (PrintExceptions.kt) has no PrintIncompleteException and never rejects a cancel, so the swallow is iOS-only in practice; reword "on iOS and Android alike" (documents.native.ts:48-50) and also accept `(error as {code?: string}).code === 'ERR_PRINT_INCOMPLETE'`, which the bridge sends beside the message.
2. DOS-152 satisfies only the finding's third clause (Close never overlaps the save action). "A slow drag does not scroll" is untouched and unexplained, and Close now sits below the fold too — a picker who cannot scroll reaches neither Short nor Close (backdrop tap and Android back still close). The walk must show a 900 ms drag scrolls; if not, record that half as still open. Compaction is DOS-118's.
3. The new guards assert exact source strings (`Platform.OS === 'ios' ? 'padding' : 'height'`, `typeof secondary === 'string'`, the import set). Acceptable as source-reading guards; they move with blocker 1.
4. Builder's NumberPad suspicion (money.tsx:220 `flex: 1`) is not a defect: a flex:1 child of a ScrollView content container (no definite height) sizes to content. Leave it.
5. list.tsx:170 `{secondary ? …}` drops a numeric 0 (pre-existing, no register passes 0).

## Conflicts with main
None. `git merge-tree --write-tree main qa/b2-lean-kit-overlays` is clean; no file changed on main since 53daedb overlaps the six; the only other unmerged qa/b2-* branch (lean-sales-entry) touches none of them. lean-kit-polish (DOS-150) reuses the Button pattern: start it from main after this merges, never edit controls.tsx:78-92 in parallel.

## READMEs
No contract change, so no generated README moves. `frontend/libs/ui/README.md` §6.12 (:175-191) says nothing about the Close footer or the keyboard; one sentence ("a Sheet rises above the soft keyboard; Close is the last row of its body") is welcome, not owed.

## Walks (after the fix, before merge)
- DOS-152 + blocker 1, Android Pixel_7_API_36 (`-memory 3072`): More sheet and the W5 Short sheet on PICK-0089 — uiautomator: panel bottom = screen bottom (no gap), ScrollView ends at the panel's padding, a 900 ms drag scrolls, Short saves (row `picked_at` set), Close is last and never under Short. iOS iPhone 16 Pro: More sheet reaches the bottom edge with no gap, heading clear of the clock.
- DOS-159, Android Gboard: Credit notes → Draft → Bill `INV/0634`: the suggestion row sits above the keyboard and a tap picks the bill; last line's decimal pad with its red error visible. iOS: credit-note Bill field and the More sheet's search — sheet lifts by the keyboard, no over-lift, no gap when it closes.
- DOS-157, Android: M7 Load-out waiting row content-desc `13 Sep, Waiting for your approval, 1375 rupees`, then `Approved`; billing/credit-notes and orders index chip columns at 1080x2400 and at 360 dp; one chip register on iOS.
- DOS-162, iOS: delivery `Send the papers` → Print → Cancel and retailer bill → Print → Cancel: no red toast, sheet's bottom button reachable. Android: cancel returns quietly (nothing to swallow).
- DOS-158, Android: Waves → tick SO-0850 → `Make a picking sheet` (409): content-desc `Make a picking sheet` once settled; again after a 200 and after the offline press.

## Defects outside this group
- frontend/libs/ui/src/native/list.tsx:170 — numeric `secondary` of 0 is dropped by the truthiness check (P4, pre-existing).
- frontend/libs/ui/src/native/feedback.tsx:198-221 — the backdrop comment still explains flex-end on the backdrop; moves with blocker 1 (same group, noted so it is not forgotten).
