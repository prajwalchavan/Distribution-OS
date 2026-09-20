# Merge review — lean-sales-rep (qa/b2-lean-sales-rep, 11 commits, 23 files, +1789/−61)

Architect: Fable · 2026-09-20 · read-only review of `git diff main...qa/b2-lean-sales-rep`. The task's design file `verdicts/lean-lean-sales-rep.md` does not exist; the group notes in `lean-groups.json` are the design and were used as such.

**Decision:** MERGE AFTER FIXES

## Fit to the findings and the group notes
- DOS-086: `AcceptedOp` + `onAccepted` fire from `settle()` after the ack is written, outside the transaction, listener throws noted (engine.ts). `ordersToSubmit` gates on the WHOLE order (header `acked`, no op of it `queued`/`sending`/`rejected`, lines matched by `data.order_id`); `submitLandedDrafts` sends `{ id, idempotencyKey: \`${id}:submit\`, deviceId }` — byte-identical to the manual button (orders/[id].tsx:154) and to the online path (new.tsx:229), so a replay is a replay. `orders.sync.ts` untouched (draft-only stands, `order_not_draft` still refuses). Submit still runs the server's credit/approval flags. Verified `enqueueMany` writes header+lines in one transaction (queue.ts), so a header-only outbox cannot occur; verified `retry()` UPDATEs the same row and acked rows are never pruned, so the rule reads the same on a later mount. Catch-up sweep on `ready`. Matches the note.
- DOS-084: `beatForDay` over `beats.visit_days` (jsonb → manifest `array` → `JSON.parse` on the device, so it IS an array, not a string) by `istWeekday(businessDate)`; manual chip kept per rep per IST day in `platform.storage`; reload-safe. Matches.
- DOS-142: `cancel_reason` on `LocalOrder`; `tablePull(salesOrders)` omits no column so it is already on the phone; the online copy maps `item.cancelReason`; no `cancelled_by` claimed. Matches.
- DOS-092: `cancelLabel` (both renderers take it), `TextInput error`, empty reason blocked with a sentence; `CancelOrderInput.reason.min(1)` untouched. Matches.
- DOS-088: `schemesForShop` — same applicability rule, no slice, newest `valid_from` then id; panel meta says the count. Matches.
- DOS-091: `dueKey` by the sign of `ageDays`; S12b reads `billing.invoices.get/pdf` (`ANY_MEMBER`, `billing` in sales `contractKeys`), the PDF is the server's, no cost field; detail routes need no `nav.ts` entry (orders/[id] has none either). docs/23 S12 corrected. Matches.
- DOS-093: `isNewShop` reads `data.code` — confirmed `toApiError` carries `err.data` (errors.ts:162) and the service throws `NOT_FOUND` + `data.code` (reporting.service.ts:1073); the test rebuilds the error through `toJSON` → JSON → `ORPCError` → `toApiError`, so it would fail on the old `error.code` read. Owner panel prints `—` with no owner string key. Matches.
- Tests: red-first is credible for 086/093/084/088/091's `dueKey`; 142/092 and the screen halves are source-regex guards (accepted — the app ESLint forbids a renderer in app sources). No validation, permission or engine test was weakened (`engine.test.ts` is additive).

## Blockers
1. **The placed-order copy still tells the rep to do the step DOS-086 now does for them** — `frontend/sales-app/src/strings.ts:218-219` (`s3.queuedBody`: "…Submit it from My orders once it lands.") and `:226` (`s3.draftBody`: "It has no number yet. Submit it from My orders."). `outcome.ts` shows `draft` exactly in the window between the acceptance and the pull — the moment the sweep is submitting — so the screen contradicts the fix and sends a busy rep to My orders for a draft that is already gone. Fix (owned file, two strings): `s3.queuedBody` → "It goes to the office as soon as there is a signal, and this phone submits it the moment it lands." ; `s3.draftBody` → "The office has it and this phone is submitting it now. If the office refuses, Needs you will say why." No code change; the DOS-180 outcome branches stay as they are.

## Minors (not blocking)
- `queue.ts:137,197,214` — `claimed` is permanent for the session and taken before `orderState`, so a submit that dies on a dropped signal (status 0/timeout) is never retried unasked; the manual button remains. Suggest: on an `ApiError` with `status === 0` (or `kind === 'network'`) delete the claim so the next sweep retries — the `${id}:submit` key makes that safe; keep refusals claimed. Also wrap the body of `sweep` (`:248,254` `void sweep()`) in a catch: `outbox()`/`getRow()` can throw while the store drains (DOS-167) and would surface as an unhandled rejection.
- `queue.ts:232-236` — `engine.sync('queued order submitted')` is a silent no-op while `after-upload` is still pulling (engine.ts:1142), so the SO number can wait for the 60 s tick in My orders (the order screen prefers `orders.get` when online, so it shows there). Same latent gap as the manual button's `onSuccess`; a `sync()` that remembers one follow-up pull when busy would close all three callers at once.
- Every mount of four screens (and every acceptance, times the screens mounted in the stack) reads the ENTIRE outbox and, on the first sweep of a session, one `getRow` per acked header ever queued — acked rows are never pruned (see Defects outside). Bounded on the pilot; unbounded by docs/20. Prune, or read `WHERE status <> 'acked' OR acked_at > now-7d`.
- A rejected LINE holds the order for ever; if the rep DISCARDS that line in the tray (`engine.discard` deletes the row) the next sweep submits the short order silently. Defensible ("the rep chose"), but worth one line in the tray's discard confirm later.
- `bills/[id].tsx:181` — label `s5.placedAt` ("Written") beside a bill's date; reuse of the order word. `s12.billed`-style "Billed" reads better. `:188` "still being made" has no retry control (query `staleTime` 60 s); the retailer R4 reference has the same, so consistent, not new.
- New files outside `ownsFiles`: `app/bills/[id].tsx` (the note asks for it), `src/lib/behaviour.ts`, six test files — none claimed by any other group.

## Conflicts
- With main: none — merge base 5f710dc IS main.
- Open branches (lean-manager-money, lean-owner-desk, lean-warehouse-pick): no shared file.
- Must rebase after this lands: lean-sales-orders-pricing (`orders/new.tsx`, `shops/[id].tsx`, `sales-app/src/strings.ts`) and lean-warehouse-stock (`docs/23`). Both already wait on this group.
- READMEs/contract: unchanged; `docs:readme:check` unaffected. `docs/23` prettier failure is pre-existing on main.

## Walks still owed (nothing in this group was walked)
- Web 390×844 + 1280: home opens on today's weekday beat, chip survives reload and resets next IST day; shop card scheme count = live schemes; new shop → "New shop" line, no Retry; Bills tab → S12b (lines, taxes, Open the bill; queued PDF state); order screen cancelled panel after a manager cancel with a reason; cancel dialog "Keep it" / "Cancel the order", empty reason shows the field error.
- DOS-086 web (Playwright `setOffline`): place offline, reconnect, the order gets its SO number with NO tap; with the blocker fixed the placed panel never says "Submit it from My orders". Then the straddle: >50 queued ops (e.g. 9 orders × 6 lines) so a header and its lines land in different batches — no `order_not_draft` in the tray, every order numbered.
- Pixel 7 (`-memory 3072`): the same DOS-086 offline run on SQLite (kill the app between the upload and the pull, relaunch → the catch-up sweep submits), DOS-084, DOS-088.
- iOS via `xcrun simctl`: DOS-092 dialog labels inside the Sheet, S12b bottomBar at iPhone width, DOS-093 line.

## Defects outside the group
- `frontend/libs/offline/src/engine.ts:1665,1904` — acked outbox rows are kept for the life of the install (only `wipe`/`end`/`discard` delete); `useOutbox` (react.tsx:615) and now the sweep re-read the whole table on every `OUTBOX_CHANNEL` change. docs/27 §8 prunes breadcrumbs after a week; acked ops need the same retention (keep 7 days so the whole-order rule stays readable).
- `frontend/libs/offline/src/engine.ts:1142` — `sync()` returns silently while a pull is in flight; callers that need "pull after this write" (new.tsx:249, orders/[id].tsx:160, queue.ts:236) get nothing and wait for the tick.
