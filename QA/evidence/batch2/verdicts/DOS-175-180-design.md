# DOS-175, DOS-178, DOS-179, DOS-180 — architect design (Fable, 2026-09-19)

Binding decisions: docs/22 §8 rows of 2026-09-19 ("fix all 4 defects", "accept all recommended"), never-list #12 and #13, and answer A of
2026-09-14 (nothing a person entered is thrown away; late cash or cheque → cashier, UPI accepted). Read-only design; every red test below is
named so the lane writes it first and watches it fail on main `6e5c7c5`. No contract, permission or database change is needed by any of
the four; the two places a builder might reach for one are flagged in §5 with the default taken instead.

## 1. DOS-175 — a receipt may name only a trip the office can settle

**Rule.** `tripId` on a receipt is acceptable only when `trips` holds that id **in the caller's tenant** and its state is one the money
can leave: `active` or `closing` (money is on the van; `TRIP_ON_THE_ROAD`, delivery.internals.ts:133 — the same set
`collections.record` already enforces at :91) or `settled` / `settled_with_variance` (then the existing mode rule applies: cash and
cheque → 409 `trip_settled`, UPI and bank transfer accepted, answer A). Refusals, in this order after the replay lookup and
`lockTripMoney` in `recordReceipt` (receivables.service.ts:696-708), so every door shares one check and the settlement race of
amendment (b) is unchanged: no row → **404 `trip_not_found`** "No trip <id> at this distributor. Record the money at the office with no
trip."; state `planned` / `loading` / `cancelled` → **409 `trip_not_on_road`** "Trip <no> has not left, or was cancelled; money is taken
while the trip is out."; settled + cash/cheque → the existing 409 `trip_settled`. Delivery supplies the SQL the way it supplies
`tripSettledSql` (module rule — receivables never names `trips`): `registerTripSettled` becomes `registerTripPredicates({ settled,
exists, onTheRoad })` from `DeliveryModule.onModuleInit` (delivery.module.ts:83), three `exists (select 1 from trips …)` fragments read
in ONE `select`. **Fail closed** with nothing registered: `exists` and `onTheRoad` default to `sql\`false\``, so a process that mounts
receivables without delivery refuses every receipt that names a trip (it cannot vouch for one); office receipts (no trip) are untouched.
**Doors.** Online `POST /receipts` answers the 404/409 above. `/sync/upload` stays 2xx: receivables.sync.ts:83-90 maps the two new
`data.code`s to `SyncRejection('trip_not_found' | 'trip_not_on_road', message)` exactly as `trip_settled`, so the tray sees a named
money code, never the generic `not_found` / `conflict` sync.service.ts:175-183 would make of it. The phone can only name a trip it
pulled (collect.tsx:161 uses `stop.trip_id`), so on a device these two codes mean the office cancelled the trip while the phone was
out; both land in the tray as money refusals and follow §2 (kept, handed to the cashier). Delivery's own `collections.record` keeps its
earlier check; the shared one is one more SELECT under the same lock.
**Existing bad rows.** Yes, they can exist in the founder's `dos` database: `pnpm smoke` runs there ("leaves its calls behind in the
pilot tenant", CLAUDE.md) and its receipts.create body carried the sampler's UUID (examples.ts:4690 sets no `tripId`, so the "ends in
Id → uuid" rule of sample.ts:126 filled it). The seed's RCPT-VAN rows join to real trips (finding, step 2). No migration: add ONE read-only
check to the Q3 repair list — `select r.receipt_no, r.mode, r.amount_paise from receipts r left join trips t on t.id = r.trip_id and
t.tenant_id = r.tenant_id where r.trip_id is not null and t.id is null and r.status = 'collected'` — and each row is undone by the desk
through `receipts.undo` (an appended reversal; it credits CASH_VAN, where the receipt posted, since a missing trip is never "settled"),
the 2026-09-14 add-never-edit method. Smoke money is not real; a real one (none expected) is re-recorded at the office with no trip.
**The example.** `'receivables.receipts.create'` in examples.ts gets `tripId: DROP` — an office receipt — so `pnpm smoke` creates a
bankable receipt and `receivables.receipts.deposit` returns 200 for the first time (the gate's proof: the run table must show it OK,
not EXPECTED). Regenerate READMEs (`pnpm docs:readme`).
**Red first.** (1) `backend/libs/core/src/modules/receivables/money-locks.spec.ts` — `it('DOS-175 a receipt naming a trip that does not
exist is refused 404 trip_not_found, one on a planned trip 409 trip_not_on_road, and neither writes a receipt or a journal line')`:
fails today with 200 + a CASH_VAN line. (2) `backend/libs/core/src/modules/delivery/settlement-money.spec.ts` — `it('DOS-175 an uploaded
receipts op naming an unknown trip is a 2xx rejection trip_not_found and writes nothing')`: fails today with `accepted === 1`. (3)
`receivables.spec.ts:551` ("lets a delivery actor take money at the door into CASH_VAN…") asserts the bug with `tripId = uuidv7()`;
the founder's approval is what allows re-pointing it at an on-the-road trip fixture (Charter A.5) — say so in its comment.

## 2. DOS-178 — a refused payment is kept and handed to the cashier

**Which kinds.** The rule is by TABLE, not by code, so it cannot drift as codes are added: a refused op on a money table — `receipts`,
`allocations`, `collections` (the insert-only money tables, docs/27 §7) — is **kept** whatever the code (`trip_settled`,
`trip_not_found`, `trip_not_on_road`, `not_permitted`, `role_not_allowed`, `amount_invalid`, …): a person entered money. Every other
table's refusal (`trip_stops`, `deliveries`, `pod_evidence`, `trip_expenses`, `sales_orders`, `pick_lines`, …) keeps today's Send it
again / Throw it away, including DOS-056's `stale` second delivery. Kept ops offer NO "Send it again" either: a retry replays the same
`opId` and the server answers the stored refusal (S-73), and the founder's route for the money is the counter, not the queue.
**Where it lives.** ONE place: `@dos/offline` exports `MONEY_TABLES` and `engine.discard(opId)` refuses a money op with
`KeptMoneyError` (row, outbox entry and `_sync_errors` line untouched); `NeedsAttentionItem` gains `kept: boolean`; a new
`engine.handOver(opId)` moves the op to outbox status `kept` and the data row's `_pending` to `'kept'` (both vocabularies gain the one
word; docs/27 §3 and §6 updated), writes `_sync_errors.handed_over_at`, and `refreshCounts` counts `rejected` as
`status = 'rejected'` only — a handed-over payment leaves the strip's "need attention" but never the phone.
**What the crew sees** (delivery D10, the only tray that holds money). A kept card: the server's sentence, then "₹{amount} {mode} from
{shop} · book no {clientReceiptNo} · {time}", then one line by mode — cash / cheque: "The office could not take this on the trip. Hand
the money and the slip to the cashier, who records it at the office."; UPI: "The money is already in the account. Tell the cashier;
the office records it."; one primary button **"Handed to the cashier"** (a Dialog: "₹{amount} · {shop} · book no {n} — stays on this
phone as handed over"), no destructive button. A new section "Handed to the cashier" under the refused list keeps them visible, with
the time; D8's `dayEndCash` stops counting a `_pending = 'kept'` receipt (day.tsx:191-194 filter), so "hand ₹X" is never asked twice.
**Where the money goes.** The cashier records an office receipt (no trip) with the same paper-book number as `clientReceiptNo`, the
link between the phone's kept card and the book; §6 of docs/22 already says so. The office cannot yet LIST refused device payments
(`sync.errors.list` is per device and `sync_errors` carries no amount) — §5.
**Red first.** (1) `frontend/libs/offline/src/engine.test.ts` — `it('DOS-178 discard refuses a rejected op on a money table and keeps
its row, outbox entry and error; handOver marks it kept and takes it out of the attention count')`: fails today (discard deletes).
(2) `frontend/delivery-app/src/lib/tray.test.ts` on a new pure `trayActions(item)` — `it('DOS-178 a refused receipt offers Handed to
the cashier and never Throw it away or Send it again')`: red as a missing module. (3) `check-in.test.ts` — `it('DOS-178 a receipt
handed to the cashier leaves the hand-over figure')`.

## 3. DOS-179 — the store's honesty is said once, from the strip, on every screen

**Where.** The `ConnectionStrip` is mounted ONCE per app in `_layout.tsx` (sales :490, delivery :537, warehouse :502) and the shell
places it on every screen — so the one shared place is the strip itself. `ConnectionState` (ui/src/types.ts:353) gains
`persistent?: boolean | null` (kit type, not a wire contract; parity.types.ts binds it); `connectionStateFrom` (offline/src/connection.ts)
maps `status.persistent` through as the tri-state; both renderers (web/feedback.tsx:31, native/feedback.tsx:35) append a second
segment on `=== false` only — web "· Not kept in this browser", native "· Not kept on this phone" — with ochre tone unless a stronger
tone already applies, on EVERY branch (offline, waiting, attention, stale, not yet, synced); `null` says nothing (ruling 3 (ee)). Two new
kit strings. The beat's `s0.notPersisted` line stays as the long form with the reason; `tray.storeMemory` / `x4.storeMemory` stay.
**The verbs.** One pure helper, `keepClaim(persistent): 'device' | 'tab'` in `@dos/offline` (null → `'tab'`: an OFFER treats null as
false, ruling (ee)), chooses the string key everywhere the app claims to keep: sales `s3.queue/queued` → "Hold until there is a signal" /
"Held in this tab only"; `s3.queuedTitle/Body` → "Held in this tab only — not saved" / "It goes to the office as a draft when the signal
returns. Close this tab and it is gone."; `s5.trayOffline`; delivery `d4.recordOffline`, `d5.recordOffline`, `d.savedOnPhone`,
`d5.recordedQueued`; warehouse `w.savedOnDevice`. **Same rule on delivery and warehouse**: the strip carries the line for all three, and
every "on this phone" verb or toast goes through `keepClaim`. Owner, manager and retailer apps write nothing offline; the strip line alone.
**Red first.** (1) `frontend/libs/ui/src/web/render.test.tsx` — `it('DOS-179 <ConnectionStrip> says the copy is not kept when
persistent is false, on every branch, and nothing while null')`: fails today (no prop, no text). (2)
`frontend/libs/offline/src/connection.test.ts` — `it('DOS-179 connectionStateFrom carries persistent as a tri-state and keepClaim
offers the device only on true')`: red as a missing export. (3) `frontend/sales-app/src/lib/dos-179-keep-words.guard.test.ts` (source
guard, the app pattern) — `new.tsx` and the three apps' offline verbs never read `s3.queue`/`d.savedOnPhone`/`w.savedOnDevice` directly.

## 4. DOS-180 — the outcome banner is bound to the order's own row

**Binding.** The Panel at new.tsx:385-388 and the button label at :309-316 stop reading `local.online`. After the tap the truth has
two sources and neither is the radio: `place.data.queued` (the mutation's own reply — `false` means `orders.create` + `submit` were
answered 200) and, for a queued order, `useRow<LocalOrder>('sales_orders', placed)` → `_pending` and `order_no`.
**States.** `queued === false` → "Order placed" / "The office has it, with its number and its price" (as today, now bound to the reply).
`queued === true`: `_pending` `queued` | `sending` → `keepClaim` title ("Saved on this phone" / "Held in this tab only") + "It goes to
the office as a draft when there is a signal. Submit it from My orders once it lands."; `_pending === 'rejected'` → "The office refused
this order" + the tray's sentence, button "Open Needs you"; `_pending === null` (acked) → "Reached the office as a draft" + "It has no
number yet. Submit it from My orders." — never "Order placed": the queued op writes `state: 'draft'` (queue.ts:56) and the office holds a
draft with no number. The pre-tap label keeps `local.online` (it is the truth about what the tap will do).
**Red first.** (1) `frontend/sales-app/src/lib/outcome.test.ts` on a new pure `orderOutcome({ queued, pending, orderNo, persistent })` —
`it('DOS-180 a queued order stays saved-on-this-phone when the signal returns and becomes reached-as-a-draft only on the ack, never
Order placed')`: red as a missing module. (2) `frontend/sales-app/src/lib/dos-180-banner.guard.test.ts` — `new.tsx` contains no
`local.online ? t('s3.placed` (fails today at :311 and :387).
## 5. Needs a founder decision, or outside this slice
- **DOS-175 default taken:** `planned` / `loading` trips refuse money (`trip_not_on_road`). Widen only if the desk must pre-assign money to
  a trip before it leaves — no such screen exists. Cancelling a trip that holds receipts is a fourth door not closed here (S-row, P2).
- **DOS-178 office half (decision):** the cashier has no desk list of refused device payments; recording at the office stays manual by
  book number. A manager/accountant screen over `sync_errors` joined to `sync_ops` payloads is a feature, not this fix. The money-table
  list is a library constant; a `money` flag on the sync manifest would be the contract change — not taken.
- **Found while reading (S-rows):** `engine.discard` sets the data row's `_pending` to NULL and leaves it (engine.ts setPending), so a
  discarded local INSERT (a delivery, a stop) stays on the phone looking server-confirmed — P2, every app. `sync_errors` has no amount or
  payload columns (schema/platform.ts:120-131). `s5.trayOffline` claims "stays on this phone" on a memory store (covered by §3).
- No contract, permission or database change in any of the four; new error codes are handler data, READMEs regenerate.
