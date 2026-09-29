# 19 — What the blind checks of the stock and money fixes left open

Recorded 2026-09-29, after the four fix lanes (stock bin and expiry, stock states, money receipts, money credit desk) were
merged into main as `1f378e6b`. Sources: each lane's build report and final blind check (bin check 4, states check 4,
receipts check 1, credit check 2), and the integration's build report and blind check of the merged tree (verdict PASS, no
blocker, no major). Those reports live in the session scratchpad, not in the repository. This file holds every minor and
every "not done" item they left that is not already a finding; small items of one kind are merged. Nothing here is on the
live server, because the fixes themselves are not there yet.

Ids DOS-364 … DOS-369 and DOS-390 … DOS-399 (DOS-370 … 389 belong to the concurrency phase, DOS-400 and up to other work).

| Id | Priority | Category | One line |
| --- | --- | --- | --- |
| DOS-364 | P2 | business-logic | A saleable return on a van-sale bill goes back onto the idle van |
| DOS-365 | P3 | ux | Unpacking an old order that named the bin: the note says "godown" |
| DOS-366 | P2 | ux | The driver's home "Take money" sheet cannot confirm another shop's cheque number |
| DOS-367 | P3 | ux | Some refusals show a bare id, or empty quotes, instead of words |
| DOS-368 | P3 | bug | Lack-of-stock refusals answer 400 in some places and 409 in others |
| DOS-369 | P3 | ux | Day-end "Confirm all" confirms at most 200 UPI receipts a press |
| DOS-390 | P3 | tech-debt | Tests: HSN codes built from one clock can collide; one race has no spec |
| DOS-391 | P3 | tech-debt | QA replay tools use a van a stale trip holds, and expectations from before the rulings |
| DOS-392 | P2 | tech-debt | `pnpm smoke`'s van-sale example will now be refused |
| DOS-393 | P2 | coverage | The screens the fixes changed were not walked in a browser or on a phone |
| DOS-394 | P3 | business-logic | Money after a write-off: three loose ends |
| DOS-395 | P3 | ux | A bill met by money on account cannot be cancelled, and the refusal does not say how |
| DOS-396 | P3 | ux | Dues words and dates still differ between screens |
| DOS-397 | P3 | bug | The GST sales register CSV mixes its total rows with the data rows |
| DOS-398 | P3 | tech-debt | Old data: what the release checks and database guards still miss |
| DOS-399 | P3 | business-logic | Bin and expiry: three gaps the bin lane left on purpose |

### DOS-364 — A saleable return on a van-sale bill goes back onto the idle van
Category: business-logic | Priority: P2 | Role: Owner / Manager (desk credit note) | Platform: API | Found by: blind check of the merged tree, minor 4

```
What happens: the desk raises a saleable credit note on a van-sale bill and names no place. The returned pieces go back onto
  the van the sale was made from, although no trip holds that van. `pnpm check:stranded` then exits 1 with
  `van-stock-no-trip`. Main behaved the same before the fixes.
How it was seen: merged-tree blind check, over the API: van C +1 after the credit note, then `check:stranded` exit 1.
What it should do: returned goods go to the godown when they can be sold again, and to the damaged / expiry bin when damaged
  or expired, never onto a van, whatever kind of bill they came from.
Ruling (architect, 2026-09-29): goods that come back by a credit note go to the godown when saleable and to the damaged bin
  when damaged or expired, never onto a van, also for a van-sale bill. P2, next stock lane.
Also for that lane: a van-stock load sheet with no trip is still accepted and puts goods on an idle van (states lane: "van-stock-
  only sheets are unchanged"), and `check:stranded` deliberately leaves such stock out. The same ruling says a van holds
  stock only while it is out on a trip; this road was not tested against it.
```

### DOS-365 — Unpacking an old order that named the bin: the note says "godown"
Category: ux | Priority: P3 | Role: Owner / Manager | Platform: API | Found by: integration build report §8 and merged-tree blind check, minor 5

```
What happens: an order from before the fixes named the damaged / expiry bin as its place and was packed. When the desk
  unpacks it, the reply marks the pieces `to: godown` while it names the bin as the place, so the manager's note reads
  "back in the godown". By the integrator's account the pieces themselves go back to the place they came from (the bin);
  where they landed was not measured by the blind check.
What it should do: the pieces and the note agree.
Ruling (architect, 2026-09-29): unpacking an old pack of an order that named the bin as its place sends the pieces to the
  godown, and the manager's note must say so. P3. The next stock lane first measures where the pieces land today.
```

### DOS-366 — The driver's home "Take money" sheet cannot confirm another shop's cheque number
Category: ux | Priority: P2 | Role: Delivery | Platform: web, Android, iOS (read in code, not walked) | Found by: receipts lane build report and blind check 1 (minor 5), merged-tree blind check (minor 6)

```
What happens: when a cheque number another shop already used is refused, the stop's collect screen shows the earlier receipt
  and a button "It is a different cheque — record it". The driver's home "Take money" sheet shows the same
  refusal sentence, which tells the driver to confirm, but has no confirm button, so the driver cannot record that cheque
  from there. The van-sale door has the same gap: it refuses the number and offers no confirmation. The desk can still
  record it.
Proof: merged-tree check, read of `home-writes.ts` (`useTakeMoney` sends no `confirmReference`) against `collect.tsx`.
What it should do: the home sheet offers the same confirmation step as the collect screen.
Ruling (architect, 2026-09-29): the driver's home "Take money" sheet and the van-sale door offer the same confirm step that
  the stop's collect screen offers when a CHEQUE NUMBER was already used by another shop. A UPI reference already used stays
  refused at every door with no confirmation (money ruling 1 of 28 Sep). P2, next delivery screen round.
```

### DOS-367 — Some refusals show a bare id, or empty quotes, instead of words
Category: ux | Priority: P3 | Role: all | Platform: API (and every screen that prints the server's sentence) | Found by: merged-tree blind check (minors 3 and 7), integration build report §8, bin lane blind check 4

```
What happens: these refusals still carry a raw id where a person expects a name:
  - an order whose place is not one of the distributor's places: "… not from location <id>" (400);
  - "stop <id> is already delivered" / "… failed";
  - "order <id> is confirmed; only a draft can be re-lined";
  - "trip <id> not found", "load sheet <id> not found";
  - "vehicle location <id> is not active" (seen on the bin lane's branch before the merge);
  - "the driver is already on trip TRIP-0005 on 2026-09-29 """: ends in empty quotes and carries no code.
  Most are older than the fix lanes.
What it should do: name the thing in words.
Ruling (architect, 2026-09-29): a refusal never shows a bare id: it names the thing in words (bill number, trip number, place
  name). One finding, P3.
```

### DOS-368 — Lack-of-stock refusals answer 400 in some places and 409 in others
Category: bug | Priority: P3 | Role: Delivery (van sale), Owner / Manager (write-offs) | Platform: API | Found by: merged-tree blind check (minor 10), bin lane blind check 4

```
What happens: a van sale asking for more than the van can sell is refused 400 "Only 4 pc … 4 pc short", while the merged-tree
  check saw the other stock refusals answer 409. The bin lane's check also saw a write-off beyond what the bin holds refused
  400 "Only 12 pc …" for the manager and the owner. The sentences are right; the status differs. Older than the fixes.
What it should do: one status for "not enough stock".
Ruling (architect, 2026-09-29): refusals for lack of stock answer 409 everywhere. P3.
```

### DOS-369 — Day-end "Confirm all" confirms at most 200 UPI receipts a press
Category: ux | Priority: P3 | Role: Manager / Accountant | Platform: API, web | Found by: receipts lane blind check 1 (minor 9), merged-tree blind check (minor 11)

```
What happens: "Confirm all" on Day-end confirms the first 200 UPI receipts listed (the list and the deposit batch both stop at
  200); the rest need another press. The blind check confirmed 142 in one press; more than 200 was not tried.
What it should do: take them all, or say how many are left.
Ruling (architect, 2026-09-29): "Confirm all" of UPI at day-end must say how many are left or take them all. P3.
```

### DOS-390 — Tests: HSN codes built from one clock can collide; one race has no spec
Category: tech-debt (tests only) | Priority: P3 | Role: — | Platform: backend test suite | Found by: integration build report §8, merged-tree blind check (minor 8), bin lane blind check 4, credit lane blind check 2 (minor 2)

```
What happens:
  - The bin-exits, credit, pricing and delivery specs each build a synthetic HSN code from the same eight digits of the
    clock. Two started in the same millisecond collide (stock-states and delivery did; the integration moved stock-states'
    clock, 8be16662, and left the others).
  - The "one live GST rate per HSN" guarantee test (S-176) can still see the legacy writer spec's synthetic heading during
    that spec's own few seconds.
  - No spec pins an approval racing a submit for one shop; the credit check passed it 10 of 10 times live.
What it should do: each spec takes a code no other spec can take, and the approval race gets a spec.
Ruling (architect, 2026-09-29): specs that build an HSN from the same clock suffix can collide when run in parallel;
  test-only, P3.
```

### DOS-391 — QA replay tools use a van a stale trip holds, and expectations from before the rulings
Category: tech-debt (QA tools only) | Priority: P3 | Role: — | Platform: `QA/tools/p7`, `QA/tools/p10` | Found by: merged-tree blind check (minors 2 and 9, §4)

```
What happens:
  - p7 s1 and s4b, p10 s6c and s8 load onto van A, which the template database's stale TRIP-ACTIVE holds: the load-out is now
    refused 409 `vehicle_on_trip` (vans and trips ruling 1). The merged-tree check had to point them at a new van to replay.
  - p7 s2 A5b expects the accountant to apply an advance by hand; the advance now meets the bill when it is issued (money
    ruling 3), so the check fails by design.
  - `recon-known.txt` keys the known DOS-258 row on TRIP-0006; the replay numbers that trip TRIP-0005, so the row reads as new.
  - Also seen in the p10 replay: S1a expects every good line in the godown (an expired-on-arrival line now goes to the bin,
    stock ruling 4); S4d's expectation depends on stock S3d left, and S3d's expired pick is now refused; s6c2 and s8 stop on
    refusals the rulings require; s4-reservations crashes at `lotName`, as it did in QA's own run.
What it should do: the tools make their own van and expect what the rulings say.
Ruling (architect, 2026-09-29): QA replay tools — p7 s1/s4b and p10 s6c/s8 use a van that a stale trip of the template
  database holds; p7 s2 A5b expects an advance applied by hand; `recon-known.txt` keys a known row on TRIP-0006 while the
  replay reports TRIP-0005. Tools only, P3.
```

### DOS-392 — `pnpm smoke`'s van-sale example will now be refused
Category: tech-debt (tooling) | Priority: P2 | Role: — | Platform: `backend/tools/smoke-endpoints.mts`, published API examples | Found by: integration build report §8, merged-tree blind check §3

```
What happens: the published example of the billing van-sale door uses the seed's order SO-9003 on van A, which the seed's
  active trip holds. The door now bills nothing off a van a trip holds (409 `vehicle_on_trip`), as the ruling requires; the
  merged-tree check saw exactly that. `pnpm smoke` has not been run on the merged tree.
  Also: the last smoke run the reports show (states lane, blind check 3, on that lane's branch) had 8 BROKEN calls outside
  the lanes' files: the `catalog.hsnRates` example fails its own schema (5), `notifications.messages.markRead` 404,
  `incentives.targets.get` and `statements.get` 404.
What it should do: the example (or the seed) uses a van no other trip holds, and smoke ends with 0 BROKEN.
Ruling (architect, 2026-09-29): the example or the seed must change before the next smoke run. P2 (tooling).
```

### DOS-393 — The screens the fixes changed were not walked in a browser or on a phone
Category: coverage | Priority: P2 | Role: all | Platform: web, Android, iOS | Found by: every lane's "not run" list; merged-tree blind check §5 ("read, not run")

```
What happens: the frontend changes passed lint, typecheck and the uncached tests (dos-app 755 tests), but no lane and no
  check opened them in a browser, Expo or a phone. Not yet seen on a screen:
  - manager: Money ("Apply money on account"; "It is a different cheque — record it"), Day-end ("UPI to confirm", "Confirm
    the ticked", "Confirm all"), Billing ("Packed, not billed": Unpack, Cancel the order; the "Credited" chip), Registers (GST
    document counts, credit-note column, "Overdue" beside "Overdue after on account"), the order panel's credit line and
    "held for credit" message, Trips ("Check the vehicle in"), goods receipt (expired on arrival);
  - owner: Money owed (the two overdue columns), Bills › GST counts, Approvals credit line and message, the bill panel's
    "Recovered after the write-off";
  - rep: the credit chip (stop, pay on delivery), the shop card's net dues, the catalogue order;
  - crew: the collect screen's cheque confirm, the door's net dues;
  - shop: its dues screen, "Credited" on its bills;
  - godown: the count screen's expired-on-arrival line, the stock screen's words.
What it should do: each is walked at desk and phone width, and on the Pixel 7, before the release reaches testers.
```

### DOS-394 — Money after a write-off: three loose ends
Category: business-logic | Priority: P3 | Role: Accountant / Owner / Delivery / Shop | Platform: API | Found by: receipts lane build report and blind check 1 (minors 3, 6, 7)

```
What happens:
  1. A rounding (or settlement) write-off is recovered by the shop's next money like a bad debt. In the check a shop paid ₹595
     for its new bill, ₹10 of it went to an old rounding write-off, and INV/9178 was left part-paid with ₹10 open. This is
     the literal reading of the ruling; nobody has said rounding write-offs are meant to be chased.
  2. Money that was on account before the fix is applied to open bills by "Apply money on account", never to recover a
     write-off (QA's RCPT-9027 on the A13 shop).
  3. The crew's collection reply carries no word of a recovery, so at the door the day's bill stays open with no reason
     given; the shop's own view of a written-off bill it later paid still says written off (the recovered amount is hidden
     from the shop by design).
What it should do: the architect says whether rounding and settlement write-offs are recovered; a recovery is told to the
  crew at the door; older money on account follows the same rule as new money, or the desk is told why not.
```

### DOS-395 — A bill met by money on account cannot be cancelled, and the refusal does not say how
Category: ux | Priority: P3 | Role: Owner / Manager | Platform: API, web | Found by: receipts lane blind check 1 (minor 4); merged-tree blind check, cross-lane X-B

```
What happens: a new bill that money on account met when it was issued is refused a cancel before dispatch (409
  `bill_has_money`), and the sentence sends the desk to "credit the whole bill" (a GST credit note). Removing the
  application first and then cancelling works (checked twice, the advance goes back on account whole), but the sentence
  does not mention it.
What it should do: the refusal names the way out: remove the money on account from the bill, then cancel it.
```

### DOS-396 — Dues words and dates still differ between screens
Category: ux | Priority: P3 | Role: Owner / Manager / Salesperson / Delivery | Platform: API, web | Found by: credit lane build report ("not done", minor 4) and blind check 2 (minors 4, 5)

```
What happens:
  1. The crew's door, the dues reminder's text and the owner's "oldest due" column still show the oldest due date of the
     gross rollup. For a shop that money on account partly covers, that date can name a bill already paid for. The credit
     check itself walks the bills net. Not done because it needs a write-path change in receivables.
  2. "Overdue" names two figures: net of money on account on the rep's shop card, gross on the owner's and the desk's
     registers (where the net stands beside it as "Overdue after on account"). The ruling allows it; the words do not say which.
  3. The owner's "held for credit" message says "Release or reject it on Approvals" while the owner is on Approvals.
What it should do: one oldest due date after money on account wherever it is shown; the rep's card says which overdue it
  shows; the message on Approvals points at the row, not at the screen.
```

### DOS-397 — The GST sales register CSV mixes its total rows with the data rows
Category: bug | Priority: P3 | Role: Owner / Accountant (and the CA) | Platform: CSV export | Found by: credit lane blind check 2, minor 3

```
What happens: since the DOS-317 fix each section of the GST sales register CSV ends on a total row (`salesTotal`,
  `creditNoteTotal`) carrying the distinct document counts. The total rows sit among the data rows, so anyone who sums a
  column over the whole file counts that section twice unless they filter on the `section` column.
What it should do: totals are kept where a sum over the data rows cannot pick them up (a separate file or block), or the
  file says plainly which rows are totals.
```

### DOS-398 — Old data: what the release checks and database guards still miss
Category: tech-debt | Priority: P3 | Role: — | Platform: database, release checks | Found by: bin lane blind check 4 (minor 2), states lane build report and blind check 4 (minors 2, 3), receipts lane blind check 1 (minor 8)

```
What happens:
  1. A place with an id older than the distributor's dock, godown or bin that already exists before migration 0075 keeps
     that seat after the migration and cannot be switched off; no release check names it. Seen on a copy planted for the
     purpose: the intruder became the distributor's dock and the real dock's 6,867 pc (6,221 held) were off the seat. The
     builder states no such place exists on main or live; that was not checked on live.
  2. `pnpm check:stranded` kind `packed-billed-not-on-dock` names every packed bill waiting on the dock for a short batch (20,
     later 25 bills for one 12-piece shortfall), not the bill that lost its pieces.
  3. Planning an old bill that is already dispatched but rides no live trip marks the planned trip "loaded" without taking
     the van lock; a van sale on that van then holds back pieces for that bill that are not on it. Reachable only on data
     `check:stranded` names `dispatched-no-trip`; no API road to that state was found.
  4. The payment-reference guard (0079) does not fire on a status change, so a receipt inserted as cancelled and set back to
     collected by hand escapes it. No product path does this.
What it should do: a release-check line for a place that sits in a fixed seat but was made after another active place of
  its kind; `packed-billed-not-on-dock` names the short bill; the other two stay documented unless a road to them is found.
```

### DOS-399 — Bin and expiry: three gaps the bin lane left on purpose
Category: business-logic | Priority: P3 | Role: Manager / Owner | Platform: API | Found by: bin lane build report ("not done") and blind check 4 (minor 4)

```
What happens:
  1. The owner's correction of a carton binned by mistake needs the owner and a written reason, but a manager reaches the
     same end in two acts: a count down at the bin, then an add at the godown. Each act is on the books with who and why,
     and an add at the godown needs no written reason.
  2. An order held on a batch before that batch expired keeps its hold. The wave does not suggest the batch and the pick
     and the pack refuse it in words, so the hold stays until the desk releases it; the migration leaves such holds as
     they were.
  3. Pieces that arrive already expired are claimed from the supplier under the kind "damaged", with a note saying they were
     expired; no "expired" kind was added.
What it should do: the architect says whether the manager's two-act road is acceptable; an order held on a batch that has
  since expired is shown to the desk; the supplier claim may name expired goods as expired.
```
