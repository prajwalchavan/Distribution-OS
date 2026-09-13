# lean-delivery-collect — architect lean design (Fable, 2026-09-13)

Run `wf_1c5f484c-b7b`. In lean mode this design IS the signed-off plan for these items. Items marked *needs-founder-decision* are built only after the founder approves the recommended default (or picks an alternative).

## DOS-066 — needs-founder-decision

### Design

ROOT CAUSE. frontend/delivery-app/app/stop/[id]/index.tsx:171-178 draws one chip (d.owes) from dues.outstanding_paise and only tints it when overdue_paise > 0; :297-305 prints 'Still due' and the open-bill count. Nothing on the screen reads dues.overdue_paise, dues.oldest_due_date or shop.credit_mode, although all three are on the device already (src/lib/local.ts:137,143,146; receivables.module.ts:60 pulls every column of retailer_outstanding_summary; DOS-072 keeps credit_mode on the crew device). Server side a credit mode has meaning only at order submit (receivables/credit.ts:76-116, docs/plans/receivables.md §4.14: indicate annotates, strict/stop raise the same credit_limit approval); neither docs/22 §8 nor docs/23 gives 'stop' a meaning at the door, so what the crew may DO is the founder's call. The recommended default (tell, never block) needs no server change: a bill on the van already passed the credit gate at submit (or the owner overrode it), and the phone's summary is only as fresh as its last pull.

CHANGE (default = tell, never block), in this order:
1. New pure helper frontend/delivery-app/src/lib/dues.ts (pattern: doorstep.ts, no @dos/ui, no React): doorDues(dues: LocalOutstanding | null, creditMode: string | null, today = today()) -> { outstandingPaise, overduePaise, oldestDueDate, daysLate, stopped, tone } with tone 'clear' | 'due' | 'overdue' | 'stopped'; daysLate = max(0, daysBetween(oldestDueDate, today)) from @dos/domain; stopped = creditMode === 'stop' (strict and indicate never change the tone); overdueLine(d, formatMoney) -> `Overdue ₹52,176 · oldest due 10 Jul` built from shortDate (./dates) — the screen passes formatINR(paise(..)) from @dos/domain.
2. index.tsx: const door = doorDues(dues, shop?.credit_mode ?? null). Header chips (the Row already wraps): keep d3-dues; add d3-overdue (family brick, solid, figure) with overdueLine when overduePaise > 0; add d3-credit-stopped 'Credit stopped' (brick, solid) when stopped. Shop panel: after the d.due Field add Field d3-overdue-amount (Money overdue, moneyM) and Txt d3-days-late '{days} days late on the oldest bill, due {date}' (pl() for the one-day form); when stopped add Txt d3-stopped-line 'The office has stopped credit for this shop — take the money before the goods go in.' Buttons unchanged: Deliver this bill stays primary, Take money stays secondary, no gate.
3. strings.ts: d3.overdue, d3.overdueLabel, d3.daysLate / d3.daysLate.one, d3.creditStopped, d3.stoppedLine.
4. Demo data: backend/libs/database/src/seed-demo/delivery.ts — if the demo's current trip carries no credit_mode 'stop' shop with overdue bills (retailers.ts:377-473 already seeds stop-mode shops), put one on it so pnpm db:seed data shows the chip too, then re-run pnpm db:seed on dos_qa as the group note says.
Nothing server-side, nothing in the outbox: the screen stays fully offline, all reads are device tables.

### Binding amendments

- (a) Tell, never block: no gate on d3-deliver, d4-record or deliveries.record, on the phone or on the server, until the founder picks otherwise. The device summary is as of the last pull and the bill on the van already passed the credit gate at submit.
- (b) Only credit_mode 'stop' earns the chip and the sentence; 'strict' and 'indicate' look exactly like today. No credit limit and no credit days on the screen (docs/23 §5.3; DOS-072 removes them from the device anyway) — 'overdue' comes from overdue_paise and oldest_due_date, which already embody the shop's credit days.
- (c) Chips carrying a figure use figure/moneyM (UX-00 §6.9); the chip row wraps; measure at 360 px that no horizontal scroll appears.
- (d) collect.tsx (d5-dues) belongs to DOS-062 inside this group: do not touch it for DOS-066. If DOS-062's builder wants the overdue line there it reuses doorDues, one import, no second rule.
- (e) dues.ts stays pure (no @dos/ui, no React) so dues.test.ts runs like doorstep.test.ts; dates come from ./dates, money and days from @dos/domain.
- (f) The founder's answer goes into docs/22 §8 (dated, tagged DOS-066) in the turn it is given and before the group merges; if the answer is not the default, rebuild only the gate (see notes), the door line stays.

### Files

- `frontend/delivery-app/src/lib/dues.ts (new — inside the group's app, no lane owns it)`
- `frontend/delivery-app/src/lib/dues.test.ts (new)`
- `frontend/delivery-app/app/stop/[id]/index.tsx`
- `frontend/delivery-app/src/strings.ts`
- `backend/libs/database/src/seed-demo/delivery.ts (only if the demo trip lacks a stop-mode shop with overdue bills)`
- `docs/22-source-of-truth.md (§8 row for the founder's answer)`

### Tests and walks

- dues.test.ts 'DOS-066 Vaibhav: outstanding 7522800, overdue 5217600, oldest_due_date 2026-07-10, today 2026-09-13 -> overduePaise 5217600, daysLate 65, tone overdue, stopped false; overdueLine renders Overdue ₹52,176 · oldest due 10 Jul' (red: module missing).
- dues.test.ts 'DOS-066 credit_mode stop -> stopped true, tone stopped; strict and indicate -> stopped false; a null summary -> tone clear and no line; overdue 0 with outstanding > 0 -> tone due and no overdue line'.
- Platform walk (dos_qa, ganesh.more, web 1280x800 and Android Pixel 7): stop 4 Vaibhav shows d3-overdue 'Overdue ₹52,176 · oldest due 10 Jul' and d3-days-late; stop 9 Khan shows d3-credit-stopped and d3-stopped-line; a stop with no overdue shows only d3-dues; at 360 px the chip row wraps with no horizontal scroll; d3-deliver on Khan still opens D4 (no gate). Screenshots d3-vaibhav and d3-khan at both widths, text read from the DOM/accessibility tree, not eyeballed.

### Founder question

**A shop on today's trip is on credit mode 'stop' (or has bills past their due date). May the crew hand over the goods, which the office already invoiced and loaded — or must the app stop them?**

Recommended default: Hand over, but tell them: the door shows the overdue amount, the oldest due date and how many days late, and a 'stop' shop gets a 'Credit stopped' chip with 'take the money before the goods go in'. No block on the phone or the server — the credit gate stays at order submit, where this bill was approved. 'strict' looks the same as 'indicate' at the door.

- Alternative: Block on the server: deliveries.record refuses delivered/partial for a 'stop' shop with overdue bills (409 credit_stopped; a 2xx rejection offline) unless a receipt on this trip has cleared the overdue amount; a failed stop stays possible and the goods ride back to the van.
- Alternative: Collect first on the phone only: a confirm sheet before Deliver on a 'stop' shop ('Take the money first?'), no server rule.
- Alternative: Also flag 'strict' shops with a softer ochre 'Credit watched' chip.

### Notes

If the founder chooses the block: add assertCreditStop(tx, stop, outcome) beside assertPodPolicy in backend/libs/core/src/modules/delivery/deliveries.service.ts:381 using the exported checkCredit(tx, retailerId, 0) from modules/receivables (index.ts:12-18; refuse when creditMode === 'stop' && overdueDays > 0 and no receipt on this trip for the shop covers the overdue amount), throw ORPCError('CONFLICT', { data: { code: 'credit_stopped' } }); sync.service.ts:175 already turns it into a 2xx 'conflict' rejection for the offline deliveries op; the app disables d3-deliver with a disabledReason and keeps Take money; spec 'DOS-066 a stop shop with overdue dues is refused delivery until a receipt on this trip clears them' in delivery.spec.ts (group-owned). Effort rises from M to L and the offline device would gate on a stale summary, which is the main reason the default is to tell rather than block. The sales app does not gate locally either (s2.creditRunsAtSubmit): the server decides at submit.

## DOS-071 — needs-founder-decision

### Design

ROOT CAUSE, three parts. (1) Expense proof: backend/libs/contracts/src/delivery.ts:1207-1208 makes proofObjectKey and inline optional, collections.service.ts:225-270 recordExpenseInTx stores whatever arrives, TripPolicySchema (contracts :296-306) carries no expense rule and tenant-bootstrap.ts:127-140 has no key — there is no policy anywhere, and what the office demands for reimbursement is the founder's rule. (2) Stale footer: deliver.tsx:612 meta={podRequired ? t('d4.podRequired') : t('d4.podNotRequired')} ignores proof, and strings.ts:200 says 'This shop is on credit' even when the policy is always and the shop pays cash. (3) Inert button: deliver.tsx:472 disabled={!totals.balanced || row.outcome !== null || proofTooBig} leaves out the photo rule, so commit() at :289 only prints the sentence.

CHANGE, in order. Items 2-3 first (app-only, built now):
1. New pure frontend/delivery-app/src/lib/pod.ts: podState({ policy, onCredit, outcome, hasProof, proofTooBig }) -> { required, blocksRecord, footer: 'attached' | 'retake' | 'required_credit' | 'required_always' | 'optional' }. required = policy === 'always' || (policy === 'credit_only' && onCredit), and never when outcome === 'failed' (mirror the server, deliveries.service.ts:388 — today's :258 gets 'always' + failed wrong); blocksRecord = (required && !hasProof) || proofTooBig.
2. deliver.tsx: replace :256-259 with podState; the d4-pod Panel meta follows footer (attached -> d4.podAttachedMeta 'Photo attached — it goes with the delivery'; required_credit -> d4.podRequiredCredit; required_always -> d4.podRequiredAlways 'The office wants a photo on every delivery'; optional -> d4.podNotRequired; retake -> d4.podRetake); d4-record disabled adds blocksRecord, disabledReason order: alreadyDone -> proofTooBig (d4.podRetake) -> photo missing (the same required sentence) -> mismatch; keep the commit() guard as a belt for the offline path.
3. strings.ts: rename d4.podRequired -> d4.podRequiredCredit, add d4.podRequiredAlways, d4.podAttachedMeta.
Item 1 after the founder approves (default = photo at or above a distributor-set amount, ₹200):
4a. backend/libs/database/src/tenant-bootstrap.ts: TENANT_SETTING_KEYS.deliveryExpenseProofMinPaise = 'delivery.expense_proof_min_paise', DEFAULT_EXPENSE_PROOF_MIN_PAISE = 20_000, one doc-table row, one seeded row in bootstrapTenant (:224-250, onConflictDoNothing so re-seeds are safe). No migration: tenant_settings is key/value and the loader falls back for a tenant without the row (expand-only by nature).
4b. contracts delivery.ts TripPolicySchema + expenseProofMinPaise: PaiseSchema (doc: an expense at or above it must carry a bill photo; 0 = every expense; default ₹200); RecordExpenseInput doc gains '400 expense_proof_required'. No input change, so no app or sync shape moves.
4c. delivery.internals.ts loadTripPolicy (:420) reads the key with int(value, DEFAULT, 0).
4d. collections.service.ts recordExpenseInTx: after the trip-state check and the existing-row short-circuit (:236-240, so a replay never turns into a refusal) and before storeInline: if (input.amountPaise >= policy.expenseProofMinPaise && !input.inline && !input.proofObjectKey) throw new ORPCError('BAD_REQUEST', { message: 'this distributor wants a photo of the bill for an expense of ₹200 or more', data: { code: 'expense_proof_required', expenseProofMinPaise } }). One rule for every caller; delivery.sync.ts:214-235 applyExpenseSync calls the same method and sync.service.ts:175 already turns the 400 into a 2xx bad_request rejection.
4e. expenses.tsx: trips.get useQuery exactly as deliver.tsx:128-133 (key ['trip', tripId], staleTime 300_000; the screen is online-only anyway, d7.online) -> minPaise = policy?.expenseProofMinPaise ?? 20_000; proofNeeded = amountPaise !== null && amountPaise >= minPaise && proof === null; d7-record disabled adds proofNeeded with disabledReason (after online and provisional) d7.proofRequired 'Photograph the bill — the office wants one for {amount} or more'; d7-photo becomes primary while proofNeeded; a d7-proof-note Txt under the amount says the same. A server refusal still lands through onError.
4f. pnpm docs:readme (the TripPolicy example changes in the delivery, owner and manager READMEs); delivery.spec.ts:86 policy type gains the field; pnpm format in both workspaces.
4g. Owner control is outside this group: frontend/owner-app/app/settings/index.tsx belongs to lean-admin-support (15), lean-retailer-platform (19) and lean-warehouse-rules (20). Log one line in docs/23 §10 for lean-retailer-platform (which also owns tenant-bootstrap.ts) to add a Money field for delivery.expense_proof_min_paise beside delivery.pod_required (:366-385); until then the owner sets it through settings.set and the default holds.

### Binding amendments

- (a) Items 2 and 3 are built and walked now without waiting for the founder; item 1 only after the answer. If the founder picks a different rule, only the threshold check in 4d and the sentence in 4e change.
- (b) The rule lives once, in recordExpenseInTx, so HTTP and /sync/upload agree; the sync path must stay 2xx — the existing ORPCError mapping in sync.service.ts:175 does it, and a spec proves it.
- (c) Keep the idempotent replay of an already-stored expense (:236-240) ABOVE the proof check: a replay never turns into a refusal.
- (d) One rule for every role: the desk booking a driver's paper bill at settlement photographs it too. No per-kind exemption in this batch; the threshold is the exemption.
- (e) A failed stop never needs POD (server :388); podState mirrors that for the always policy as well, which today's deliver.tsx:258 misses.
- (f) pod.ts stays pure (no @dos/ui, no React), tested like doorstep.ts.
- (g) The setting key is added only to TENANT_SETTING_KEYS in tenant-bootstrap.ts — the single registry — as a 3-line additive edit to a file two later groups also touch; name it in the commit message so their rebase is trivial. No SQL migration.
- (h) docs/22 §8 gets the founder's answer (dated, tagged DOS-071) in the turn it is given; docs/23 §10 gets the owner-app control line.

### Files

- `frontend/delivery-app/src/lib/pod.ts (new)`
- `frontend/delivery-app/src/lib/pod.test.ts (new)`
- `frontend/delivery-app/app/stop/[id]/deliver.tsx`
- `frontend/delivery-app/app/expenses.tsx`
- `frontend/delivery-app/src/strings.ts`
- `backend/libs/contracts/src/delivery.ts`
- `backend/libs/database/src/tenant-bootstrap.ts (outside the group: the settings-key registry and its seeded default; additive)`
- `backend/libs/core/src/modules/delivery/delivery.internals.ts (outside the group: loadTripPolicy, owned by no lane)`
- `backend/libs/core/src/modules/delivery/collections.service.ts (outside the group: the expense write, owned by no lane)`
- `backend/libs/core/src/modules/delivery/delivery.spec.ts`
- `backend/*-service/README.md + app READMEs (regenerated by pnpm docs:readme)`
- `docs/22-source-of-truth.md (§8 row)`
- `docs/23-app-screens-and-api-gaps.md (§10 line for the owner-app control)`

### Tests and walks

- pod.test.ts 'DOS-071 credit_only + credit shop + no photo -> required, blocksRecord, footer required_credit; with a photo -> footer attached and blocksRecord false; always + cash shop -> required_always; failed outcome -> never required; proofTooBig -> blocksRecord with footer retake' (red: module missing).
- delivery.spec.ts 'DOS-071 a ₹500 diesel with no proof is 400 expense_proof_required; the same with inline proof is 200; a ₹150 parking below the threshold with no proof is 200; with delivery.expense_proof_min_paise = 0 even ₹150 is refused' (red: today every case is 200).
- delivery.spec.ts 'DOS-071 a trip_expenses op over the threshold with no proof_object_key through /sync/upload answers 2xx with a bad_request rejection and writes no trip_expenses row' (extends the case at :1321; red: today accepted).
- delivery.spec.ts 'DOS-071 trips.get carries policy.expenseProofMinPaise 20000 by default' (extends :605).
- Platform walk (web 1280x800 and Android Pixel 7): D4 on a credit shop — d4-record disabled with the credit sentence before a photo (d-08), after 'Photo attached' the d4-pod meta reads 'Photo attached — it goes with the delivery' (d-09); D4 on a cash shop with pod policy always shows the always sentence; D7 — ₹500 diesel without a photo leaves d7-record disabled with the ₹200 sentence and d7-photo primary, ₹50 parking records without a photo, ₹500 with a photo records and the list row shows the photo chip. Text read from the DOM/accessibility tree, screenshots d4-before, d4-after, d7-blocked, d7-small.

### Founder question

**Must a trip expense (diesel, toll, parking) carry a photo of its bill before it can be recorded?**

Recommended default: Yes, at or above a per-distributor amount, ₹200 unless the owner changes it (0 = every expense): diesel always has a pump bill, a ₹30 parking slip often does not. The rule runs on the server for the crew and the desk alike, and the phone says why the button is off.

- Alternative: Always, for every rupee (the same setting with default 0).
- Alternative: Never — keep today's optional photo and only nudge on the phone.
- Alternative: Per kind: diesel always, toll and parking never (a second setting).
- Alternative: A three-word policy like the POD one (always / above_amount / never) — the same thing with more words.

### Notes

The seeded expenses (seed-demo/delivery.ts:552-563) are inserted directly and stay as they are; the rule is a write-time check, not a data guarantee. expenses.tsx already refuses to record offline (d7.online), so reading the policy through trips.get adds no offline dependency; the offline trip_expenses op exists only in the spec and gets the same rule through recordExpenseInTx. Item 4 of the finding (Back to the trip on a finished stop) is DOS-061, already merged.

