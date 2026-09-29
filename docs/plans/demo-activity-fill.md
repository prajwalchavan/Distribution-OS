# Dummy activity on top of the real master data (brief for the lane `feat/demo-fill`)

Decision: docs/22 §8, 2026-09-28, last row. One site, one database. The pilot's real shops, items, prices,
stock and opening dues stay as they are; a tool adds dummy activity so that every role opens on work, and
tops it up every night.

## What is built

| Piece                     | Where                                                               | What it does                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tool                  | `backend/tools/fill-demo-activity.mts`, `pnpm fill:demo`            | Drives a RUNNING API over HTTP with the contract's own shapes, signed in as the people who would do each step. Dry run by default; `--commit` writes. `--api <url> --tenant <slug> --owner-password-file <path> --logins-file <path>`                                                                                                                                              |
| The coverage check        | `backend/tools/check-demo-coverage.mts`, `pnpm check:demo-coverage` | Signs in as every tester login, reads each role's home and lists, exits 1 and prints the gap list when one of them is empty                                                                                                                                                                                                                                                        |
| The marker check          | `backend/tools/check-demo-rows.mts`, `pnpm check:demo-rows`         | Counts dummy rows by kind and proves rule 3 below (no dummy receipt or credit note touches a bill the tool did not make)                                                                                                                                                                                                                                                           |
| The founder's one command | `backend/infra/oracle-vm/fill-demo.sh`                              | From the Mac: on the VM, restore the latest dump of the real database into a scratch copy, start a second API on a spare port over that copy, run the tool and the three checks THERE; only if all pass, run the tool on the real API (`127.0.0.1:3100`), run the checks, install the nightly cron line (06:00 IST), drop the scratch copy. Prints PASS / FAIL lines and no secret |

## Rules (architect; each one is checked by the blind verify)

1. **Through the app only.** Every write is an API call a person could have made, with `id` and
   `idempotencyKey` from the tool. No SQL writes, no service called in-process, no migration. (If the lane
   proves a migration is unavoidable it stops and reports; numbers 0084 and 0085 are reserved for it.)
2. **Every dummy row is marked.** Idempotency keys start `demo-fill:<business date>:`; ids are derived from
   that key, so the same date run twice writes nothing the second time. Where the row has a note or remark
   field the tool does not fill it with the word "demo": the data has to read like a working day.
3. **Dummy money never settles a real bill.** Receipts, cheques and credit notes made by the tool are
   allocated only to bills the tool made. Imported opening bills are never touched.
4. **Tester logins are the tool's own, plain, and sign in with the demo password** (founder, 2026-09-29, in his
   words "keep password of all [the demo password]. And usernames also basic"; this replaces the first wording
   of this rule):
   - **Usernames** are plain: `manager`, `accounts`, `sales1`, `sales2`, `godown`, `driver1`, `driver2`, and
     `shop1` … `shop3` for three real shops that have no login (listed for the record: no procedure gives a shop
     a sign-in yet, DOS-400). No owner login is made. For a second distributor on the same database the suffix
     rule stays: `manager.<suffix>`.
   - **Password**: every tester login's is the demo password, the one the demo seed gives every demo user; the
     tool takes it from the seed's own definition (`DEMO_PASSWORD`, `backend/libs/database/src/seed-demo/`) and
     no file of the tool writes it. It is set through the product's own doors: the owner makes the login with a
     temporary password, the tool signs in as the person and changes it, so no forced change of password is left
     and a tester signs in and lands on work. A tester whose password someone changed is set back the same way.
   - **The owner keeps his own sign-in**: the tool never sets, changes or writes the owner's password. The
     existing staff and their passwords are left alone.
   - **The logins file** (mode 600: username, password, role) lists the tester logins so that a person sees who
     exists. Nothing else the tool, the checks or the wrapper print, log or report carries a password (rule 5).
   - **A plain username that is someone else's** (the distributor's own staff, or a person of another
     distributor, whom no read of the API shows) is never taken and its holder never touched: the tool asks the
     product first without making anything (`staff.create` with that username and the OWNER's own phone, which the
     product refuses either way: "already a member" when the only person it finds is the owner, so the name is
     nobody's; "two different people" when the name is someone's), takes the next free plain name (`manager2`, then
     `manager3`; `sales3` for `sales1`), says so in its report (usernames and counts only) and writes the name it
     took to the logins file. It finds its own people again by the mark it made them with (the user id derived
     from its idempotency key), not by the username. Should the API still hand the new login to someone else (the
     phone the tool drew for the tester is theirs), the tool switches that login off at once and takes the next
     name.
   - **A database the tool ran on before this decision** (logins `tester.manager` … `tester.driver2` with
     generated passwords in its logins file) is healed in one run. What the product lets one person hand to
     another is carried by the new logins the way "finish yesterday" does; what it does not is finished by the old
     person first; the old logins are switched off at the end of the run (`staff.setStatus`, the product's
     procedure for a staff member who left) and the report names every trip concerned (ids only):
     - _A trip on the road_ (of an earlier day, or of the run's own date) cannot be handed over: a trip's driver is
       fixed when it is planned. Its own driver signs in — with the password the old logins file holds for it,
       else the demo password, else the owner sets a temporary one and the person changes it to a fresh one the
       tool keeps in memory for that run only — delivers the last doors and checks the van in; the new accountant
       settles it. A login that could not be signed in at all has its trip finished by the desk (the product gives
       the owner and the manager every doorstep step), and the report says so. A login still driving an open trip
       (a step refused) stays on until the next run finishes the trip.
     - _A trip that has not left_ (the van load the old crew planned for the next morning, whatever its date) is
       cancelled by the desk, its draft sheet with it; its bills go back on the planning board and take the first
       free doors of the next morning's vans of the new drivers (before the other waiting bills; a bill no door can
       take waits for the day after, as every waiting bill does).
     - _A rep's beat_ goes to the new rep; the old assignment ends the day before the run's date, or on that date
       when the old crew already worked it.
     - _A wave_ is picked and packed by the new godown login (any godown login may).
     - _A date the old logins already made_ keeps their orders and trips (an order's salesperson and a trip's
       driver are fixed when made). Run on that same date, the new crew takes its own SHIFT of it: its orders,
       waves, vans, van load and desk work of that date under ids tagged with the shift (`s2`), after the old
       drivers finished and checked in their trips of the date, so every role opens on work of its own that day;
       the report says so. A date one crew made keeps the ids it always had (the live database is never in that
       state). The same date run again writes nothing.
5. **No name of a real shop, no phone number, no GSTIN in any output, log, report, fixture or commit.**
   Output is counts and ids.
6. **A run has two halves.** _Finish yesterday:_ whatever the tool left open on an earlier date is carried
   to its end the way a crew would (remaining doors delivered or brought back, trip checked in and settled,
   cash handed over, cheques listed for deposit). _Make today:_ see the table below. A failure in one step
   is counted and reported and the other steps still run.
7. **It must leave the books right:** after a run, stock ledger = balances, every journal balances,
   `check:stock-cancels` is 0, dues = bills − receipts − credit notes to the paisa.

## What "today" contains after a run (per distributor)

| For        | On the landing page there must be                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Shopkeeper | an order on the way, an order delivered with its bill, dues, at least one offer, "order again"                                     |
| Sales rep  | today's beat with shops to visit, two orders already taken, one shop over its credit limit                                         |
| Manager    | orders waiting for approval (one held for credit), a load sheet to sign off, a supplier bill in review, a return to approve        |
| Godown     | goods at the gate to count, a wave to pick, packs to make, a van to load                                                           |
| Driver     | a trip today with 6 to 8 doors: some delivered and paid (cash, UPI, cheque), one part delivered, one refused, the rest still to do |
| Accountant | today's collections to match, cheques to deposit, yesterday's trip settled, dues by age                                            |
| Owner      | today's sales, collections, dues, stock value, approvals waiting — none of them zero                                               |

Quantities are small (about 25 orders a day) and drawn from the distributor's own items, prices and shops;
the tool asks `pricing.quote` for every price and never invents one. An item without a price or without
stock is skipped, not forced.

## How the lane tests it (never on real data)

- Worktree `.claude/worktrees/demo-fill`, branch `feat/demo-fill` from main, API on port **3850**, database
  **`dos_test_fill`** (its own; never `dos`, `dos_live`, `dos_test_hosted`, `dos_test_sim`,
  `dos_test_legacy_import`, `dos_test_ux` or another lane's). Never a request to `api.distributionos.in`.
- The tenant under test is built THE WAY LIVE WAS BUILT: `bootstrapTenant`, then the legacy importer's
  writer fed a synthetic plan with invented names (about 120 shops, 84 items, 15 beats, opening bills,
  opening stock; `backend/tools/legacy/testing.ts` has the builders), an owner login, nothing else.
- Second target: a database with the ordinary demo seed, to prove the tool also tops up a tenant that
  already has activity.
- Finding ids DOS-400 … DOS-419.

## Blind verify (a fresh agent, no knowledge of the build)

Builds both targets again from nothing, runs the tool twice for the same date (second run writes nothing),
runs the three checks, reconciles rule 7 in SQL, proves rule 3 and rule 5 by search, then opens a static web
export against the lane API at phone width and signs in as each tester login: the landing page must show
the work in the table above. Then it breaks things on purpose (API down midway, a login whose password was
changed, an item with no stock) and runs again: the run must report and heal, never duplicate.

## Round 2 (founder, 2026-09-29: "no field must be empty, no 0s, every functionality must have some data")

Starts when round 1 has passed its blind check. Same lane, same rules.

1. **The sweep.** `check:demo-coverage` grows from "each role's home and lists" to **every GET of every service the role may call** (the smoke harness already knows them all): an empty list, a zero count or a zero amount is a gap, printed by role, screen and procedure. It exits 1 on any gap that the tool could fill and names, apart, the ones no procedure can fill.
2. **The owner's home has no zero:** booked, held, billed, packed with no van, on the road, delivered AND failed, collected by cash AND UPI AND cheque, banked of today's money, owed; invoiced, collected, outstanding and orders today. So each day's run ends with some of today's money banked (a deposit and a UPI confirmation by the accountant) while other money is still to bank.
3. **Every menu entry has rows:** approvals of each kind (credit, rate, load-out), the live map (the drivers' positions of today's trips), offers, claims on a brand, targets, returns and a credit note, a bounced cheque, a write-off, supplier bills in every state, a gate count with a difference, registers and exports, notices for every role.
4. **Shopkeeper sign-ins** `shop1…3` through the desk's new procedure (lane `feat/shop-login`), on the three shops that stand in for them today.
5. Graphs of past days are not forced: nobody can date a bill in the past (DOS-403). They fill as the nightly runs add up.
6. **Every screen, in a browser (founder, 2026-09-29, second message).** The sweep also WALKS every route of every role at phone width, from the navigation data the app itself uses, and fails on a screen that shows its "nothing here" state (the kit's empty state carries a test id for this; add one if it has none). The list of screens is the app's own route table, not a list kept by hand.
7. **The live map:** the tool reports positions for today's trips through the delivery API the driver's phone uses (along the road between the stops of the trip, a point a minute for the last hour), so "Vehicles now" and "Trip trace" show today's vans. If no procedure takes a position, that is a finding and the map stays a named gap.
8. **Supplier bills, really read:** bills generated by `QA/tools/docint-bills/` (lane `feat/docint-local-reader`) with invented suppliers and the distributor's own item names are uploaded as the godown login and read by the free reader, so the desk has a bill being read, one to review, one reviewed and one posted. Needs that lane merged.
