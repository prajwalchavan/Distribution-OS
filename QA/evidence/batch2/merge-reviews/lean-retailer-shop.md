# Merge review — lean-retailer-shop (qa/b2-lean-retailer-shop, 7 commits, 25 files, +677/−40)

Architect: Fable · 2026-09-13 · read-only review of `git diff main...qa/b2-lean-retailer-shop` (base 663c6f3, main now 4249109). No group design verdict exists; the DOS-146 verdict and the group note are the binding guidance for the Pay slice. No lane-result file exists yet for this group and every `platformCheck` in the builder's report is written in the future tense, so nothing here has been walked.

**Decision:** MERGE AFTER FIXES

## Fit to the findings and the group notes
- DOS-101: `onOpenPieces` wired on both R7 steppers, `PiecesSheet` is a line-for-line copy of sales-app's DOS-085 sheet, commits through R7's own `setQty` so `enteredFor()` labels a non-multiple `piece`; kit strings and `parsePieces`/`stepPiece` exports exist on main. Right.
- DOS-123: `absoluteUrl(proof.readUrl)` + null filter in `bills/[id].tsx`; seed `objectKey: null` (mapper answers `readUrl: null`); seed test pins it; `delivery.ts` is the only POD seeder. Right, and the honest choice.
- DOS-124: `?bill=<id>` from both buttons; `pay.tsx` validates the id against `dues.data.bills`, seeds `chosen` once per param, never over an untick. `/pay` is not a tab (`src/nav.ts`), so each push is a fresh instance. Right.
- DOS-105: own `useCreditNoteWord()` (exhaustive over `CreditNoteState`), cancelled order hides the bar, `requestedBy === session.user.id`, `cancelLabel` "Keep it", `longIsoDate` in `queueDuesReminders` + spec. Right as far as it goes (see blocker 3).
- DOS-143: `longInstant` on `businessDate`, two call sites, unit spec. Right.
- DOS-154: `value={payable}`, helper swap, native dashed frame + secondary tone. Only the first of the note's three clauses (see blocker 2).
- DOS-144: bar shows the bill's `amountDuePaise` + "See the bill". Right for the bar; wrong for the lines (blocker 1).

## Blockers
1. **DOS-144 prints "0 of N pc, N short and not billed" on every line of every packed or dispatched order.** `orders/[id].tsx:198` computes `short = line.qtyPcs - line.deliveredQtyPcs` whenever a bill exists, but the bill is issued at pack and `sales_order_lines.delivered_qty_pcs` (default 0) has ONE writer, `recordDelivered` at the door (`backend/libs/core/src/modules/orders/fulfilment.ts:319`); the seed sets it to 0 for every state but delivered/partially_delivered (`seed-demo/sales.ts:1935-1938`). So between pack and delivery every line reads "0 of 60 pc, 60 short and not billed". The builder's SO-0903 case (delivered) cannot show it. Also `deliveredQtyPcs` may include free pieces (ceiling `qty + free`, fulfilment.ts:350), which masks a real short on a line with free goods, and a door-side shortfall is a credit note, never "not billed". Fix: "short and not billed" is `line.qtyPcs - line.pickedQtyPcs` (`recordPick` writes paid pieces only, clamped `0..qtyPcs`); print `{picked} of {ordered} pc, {short} short and not billed`; leave door-side returns to the credit-note panel. Update `dos-144-order-short-pick.guard.test.ts:23` to `pickedQtyPcs`, and walk one packed/dispatched order on dos_qa as well as SO-0903.
2. **DOS-154 leaves the two DOS-146 clauses the group note makes binding.** `pay.tsx:167` still has `onChange={setAmount}` and the kit emits `null` on an emptied field (`web/money.tsx:239`, `native/money.tsx` desk branch, pad Clear): `amount` becomes null → `payable` is `owed` → web/desk blur reformats to the full dues and the phone pad's Clear re-shows the full dues (`NumberPad value={value}`), i.e. the snap-back the verdict names, and a 0 typed by hand disables Start with "Nothing is pending. You are clear." (`r3.noBills`) — the wrong reason. Fix as in DOS-146: `null` = untouched (shows `owed`, sends no `amountPaise`), `onChange={(next) => setAmount(next ?? 0)}` so an emptied field is 0 and stays 0; Start's `disabledReason` gets a third branch for `owed > 0 && payable <= 0` ("Enter an amount", new r5 string); extend `dos-154-pay-amount.guard.test.ts` (no raw `onChange={setAmount}`, the new reason present). Walk: web select-all + delete + blur → 0.00 and the reason; Android pad Clear → ₹0, Done → ₹0.00, never ₹35,843; untouched → owed.
3. **DOS-105's ISO date survives the reseed.** The inbox row the finding photographed is seeded, not swept: `seed-demo/notifications.ts:558` passes `outstanding?.oldestDueDate ?? isoDate(daysAgo(20))` straight into the `dues_reminder` variables, so the builder's "re-run pnpm db:seed" follow-up cannot fix step 4. The file is in the group's `ownsFiles`. Fix: format it `6 Aug 2026` in the seed (a five-line local helper; `@dos/db` must not import `@dos/core`) and add one assertion to `seed-demo.test.ts` that no `dues_reminder` body matches `/\d{4}-\d{2}-\d{2}/`.

## Minors (not blocking)
- DOS-123 guard is satisfied by the wrong line: `document-urls.test.ts:160` looks for `url = absoluteUrl(`, which `bills/[id].tsx:82` (the DOS-099 PDF) provides; the POD line is `url: absoluteUrl(` (:302) and would pass the guard even if reverted. Accept `[:=]` in the regex.
- DOS-144 `bills.data?.items[0]` is the newest invoice (`desc(invoices.id)`); a cancelled-before-dispatch invoice would show "Paid in full ₹0.00 · See the bill". Prefer `items.find((i) => i.state !== 'cancelled')`.
- DOS-143 `retailer-app/src/lib/dates.test.ts` never runs in CI: the app has no `test` script. Add `"test": "vitest run --dir src"` + `"vitest": "catalog:"` as sales-app did (lockfile changes, `pnpm install`).
- DOS-105 leftovers the finding lists and nobody owns: office reason codes on returns ("Return saleable", "Rate difference") and the three phrasings of one number (bill/list/dues). Record, do not fix here.
- `backend/libs/database/dist` is stale on any checkout that reseeds: build `@dos/db` before the dos_qa reseed the group asks for.

## Conflicts with main
None: `git merge-tree --write-tree main qa/b2-lean-retailer-shop` is clean; no branch file changed on main since 663c6f3 (only docs/22 and QA state landed). In-flight `qa/b2-lean-backend-platform` and `qa/b2-dos167` touch none of the 25 files. lean-kit-polish (DOS-150) also owns `native/money.tsx`: start it from main after this merges.

## READMEs
None: no contract, permission or schema change; `pnpm docs:readme:check` is unaffected.

## Walks still owed (all — none were run)
- Web 1280×800 + 390 px and Pixel 7: R7 "Pieces" on Godavari UHT Milk (9 pc left) → type 9 → line `entered_unit = piece`, 9 pc in the DB; the sheet keyboard rises on first open.
- Web + Android: My bills → INV/0830 POD loads (naturalWidth > 0) from :3006's origin; a seeded bill after reseed shows no photo row.
- Web, Android, iOS (Expo Go; Pay slice): Money due → Pay this bill → Start → /pay ticked to that bill, its amount only; same from bill detail; Pay everything → tick one → field reads that bill's total with a dashed frame; the blocker-2 empties.
- Web + Android: Returns badges "Credited"; SO-0310 no footer; a rep-raised bargain reads "Your salesperson asked"; cancel dialog "Keep it"; inbox reminder reads "since 6 Aug 2026" after reseed.
- Web + Android: an order created between 00:00 and 05:30 IST reads the IST date on Home and My orders; SO-0903 reads "54 of 60 pc, 6 short and not billed" and INV/9010's due; a packed and a dispatched order read plain quantities (blocker 1).

## Defects outside the group
- `backend/libs/database/src/seed-demo/sales.ts:1935` — delivered pieces exclude free goods while core `recordDelivered` (fulfilment.ts:350) and `seed-demo/delivery.ts:514` include them; the seeders disagree on what `delivered_qty_pcs` counts (P4).
- `frontend/libs/ui/src/document-urls.test.ts:160` — the identifier rule is file-level by design, so any file with one `x = absoluteUrl(` passes every other `source={x}`/`documents.open(x)` in it (pre-existing, P4).
