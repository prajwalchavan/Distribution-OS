# lean-retailer-platform — architect lean design (Fable, 2026-09-13)

Run `wf_1c5f484c-b7b`. In lean mode this design IS the signed-off plan for these items. Items marked *needs-founder-decision* are built only after the founder approves the recommended default (or picks an alternative).

## DOS-100 — needs-founder-decision

### Design

ROOT CAUSE. (1) backend/libs/core/src/modules/notifications/events.ts:148-192 `handleOrderSubmitted` queues `order_needs_approval` push/in_app notices to owner/manager devices only; the shop hears nothing until `OrderConfirmed` (`order_confirmed`, events.ts:124-141), which for a held order may be days away. (2) backend/libs/core/src/modules/orders/orders.internals.ts:250-269 `emitOrderEvent` publishes {orderId, orderNo, retailerId, state, totalPaise} and NOT `approvalFlags`, and `orders.service.ts:288` emits `OrderSubmitted` with state 'submitted' for every submit, held or not, so no handler can tell a held order from one that auto-confirmed in the same transaction. (3) frontend/retailer-app/app/orders/[id].tsx prints `word(detail.state)` = 'With the distributor' (strings.ts:388) and never reads `approvalFlags`, which is already on the wire for the retailer role (orders.mappers.ts:34; only `approvals` is stripped at orders.service.ts:679).

CHANGE, in this order.
A. Event payload: `emitOrderEvent` adds `approvalFlags: order.approvalFlags` (additive JSON; one line in orders.internals.ts, outside the owned files because the payload is the interface between orders and notifications).
B. Contract: `PLATFORM_TEMPLATE_KEYS` (contracts/notifications.ts:183) gains `'order_on_hold'` after `'order_needs_approval'`. Variables: orderNo, totalRupees; `distributorName` is sender-supplied like `welcome`.
C. Seed: seed-demo/notifications.ts platform rows for `order_on_hold` on `in_app`, `whatsapp` and `sms` (body: 'We have your order {{orderNo}} for {{totalRupees}}. {{distributorName}} is checking it and will confirm shortly.'). Seeding all three channels makes the founder's channel choice a one-line handler change, never a new seed. Re-run `pnpm db:seed` on dos_qa; if verify-seed counts template rows, update its expectation.
D. Handler: `handleOrderSubmitted` reads `approvalFlags` from the payload; `held = flags.length > 0`. When NOT held: outcome 'ignored', reason 'auto-confirmed' — the desk push for a flag-less order was spurious (it announced 'waiting for your approval' for an order already confirmed) and stops. When held: keep the staff loop, then queue ONE shop message via `queueShopMessage(tx, {contact, sender}, { retailerId, templateKey: 'order_on_hold', refType: 'order', refId: orderId, channel: 'in_app', variables: {orderNo, totalRupees}, idempotencyKey: `${event.eventType}:${event.aggregateId}:shop` })`. A shop with no login (`no_phone` skip for in_app) is skipped silently, as `welcome` is. Outcome 'queued' if either half created a row, 'replayed' otherwise.
E. Screen (orders/[id].tsx): when `detail.state === 'submitted' && detail.approvalFlags.length > 0` render a Panel testID `r8-hold`: title 'Waiting for {name} to confirm this order'. If flags include `credit_limit`: `useQuery(['outstanding', retailerId], receivables.outstanding.get({retailerId, includeBills:false}))` (DUES_READERS already includes retailer) and print 'Your earlier bills: ₹{overdue} overdue. Paying it is the quickest way to release this order.' with a Button `r8-hold-pay` → `/pay` when overduePaise > 0; when overdue is 0: '{name} is checking your account before confirming.' Other flags: '{name} is checking a rate on this order.' NEVER a credit limit or credit-available figure (ADR 0006; CREDIT_CHECKERS excludes retailer). The order chip on R8 list, R8 detail and R2 recent orders reads 'Waiting for approval' (new `word.submittedHeld`) when state is submitted with flags, else the existing 'With the distributor'.
F. Strings: r8.holdTitle, r8.holdCredit, r8.holdCreditNone, r8.holdOther, r8.holdPay, word.submittedHeld.

### Binding amendments

- (a) The shop message goes on channel `in_app` only (founder default). If the founder chooses WhatsApp, change ONLY the `channel:` argument in the handler to undefined (opt-in resolution) — the seed already carries the whatsapp and sms bodies.
- (b) The handler decides 'held' from `approvalFlags` in the OrderSubmitted payload, never by reading `sales_orders` or `approvals` (the event is the interface, events.ts header).
- (c) The staff `order_needs_approval` push is also gated on `held`; the spec pins that a flag-less OrderSubmitted queues nothing to anyone.
- (d) No credit limit, credit available, or approval payload ever reaches the retailer app: the screen shows the overdue amount from `receivables.outstanding.get` only, and `orders.get` keeps stripping `approvals`.
- (e) The template body never names 'credit': the shop learns its order is being checked and, from the app, that overdue bills release it; the message text is the same for every flag.
- (f) Idempotency keys: `OrderSubmitted:<orderId>:<deviceId>` for staff (unchanged) and `OrderSubmitted:<orderId>:shop` for the shop; a relay replay must add zero rows.
- (g) Run `pnpm docs:readme` after the contract edit and re-seed dos_qa; `pnpm smoke` must still end with 0 BROKEN.

### Files

- `backend/libs/core/src/modules/orders/orders.internals.ts (1 line: approvalFlags in the outbox payload — outside owned files, additive)`
- `backend/libs/contracts/src/notifications.ts`
- `backend/libs/database/src/seed-demo/notifications.ts`
- `backend/libs/core/src/modules/notifications/events.ts`
- `backend/libs/core/src/modules/notifications/notifications.spec.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts (one assertion on the payload — outside owned files)`
- `frontend/retailer-app/app/orders/[id].tsx`
- `frontend/retailer-app/app/index.tsx (chip wording only)`
- `frontend/retailer-app/src/strings.ts`

### Tests and walks

- notifications.spec 'DOS-100: an OrderSubmitted event with approvalFlags queues ONE in-app order_on_hold message to the shop (refType order, key OrderSubmitted:<id>:shop) beside the desk push, a replay adds nothing, and a shop without a login is skipped' — red today (unknown template key, no row), green after.
- notifications.spec 'DOS-100: an OrderSubmitted event with empty approvalFlags queues nothing — not to the desk, not to the shop' — red today (desk push is queued), green after.
- orders.spec 'DOS-100: the OrderSubmitted outbox payload carries approvalFlags' — red today.
- retailer-service spec: describePermissionMatrix unchanged (no new route) — must stay green.
- Platform walk (web desk 1280, web phone 390, Android Pixel 7): as ramesh.gupta (strict credit, ₹35,843 overdue) place an order over the limit → R8 detail shows the r8-hold panel with the overdue amount and a Pay button, the list chip reads 'Waiting for approval', R12 shows the order_on_hold message; place a small order that auto-confirms → no hold panel, one 'confirmed' message, and the manager app gets no 'needs approval' push for it.

### Founder question

**When a shop's order is held for the distributor's approval, should the app's message 'We have your order, {distributor} will confirm shortly' be in-app only (free) or also a paid WhatsApp/SMS message? And is it right that the shop sees how much of its earlier bills is overdue but never how much credit it has left (ADR 0006)?**

Recommended default: In-app only for the hold message (no per-message cost, no Meta template approval, the shop just used the app); the order screen shows the overdue amount with a Pay button and never a credit limit or credit-available figure.

- Alternative: Also send it on WhatsApp (falls back to SMS) using the shop's opt-in — costs per message and needs the template approved by Meta; the seed already carries the wording, so it is a one-line switch later.
- Alternative: Show 'credit available' on the retailer app — contradicts ADR 0006 and the CREDIT_CHECKERS matrix; would need that decision revoked first.

### Notes

Overlaps DOS-096/101/105 only on the order screen; no contract those items own changes. The spurious desk push for auto-confirmed orders is fixed in passing because the same gate decides both halves; the verifier should confirm the manager app's approval badge is unaffected (it reads `approvals`, not messages). Depends on the founder answer only for the channel line; build the default.

## DOS-102 — needs-founder-decision

### Design

ROOT CAUSE. frontend/retailer-app/app/index.tsx:5-11 and :182-232 deliberately fetch dues for the OPEN tenant only, because every read is scoped by the token and reading another distributor's dues would mean `auth.switchTenant` behind the user's back; `MembershipSummarySchema` (contracts/auth.ts:94-104) carries name, logo, role, status and no dues. sign-in.tsx:5-8 lands in the first membership because `LoginInput.tenantId` is omitted and nothing remembers the last distributor.

HOST, MODULE, PERMISSION (architect's call). The read is cross-tenant by nature, so it lives on auth-service (:3000) behind `AccessTokenGuard`, exactly where `auth.me` lives: a new nested contract `auth.memberships.summary` → GET `/auth/memberships/summary`, PERMISSIONS row `'auth.memberships.summary': 'authenticated'` next to `'auth.me'`. The handler never mints a token, session or auth_events row: for each ACTIVE membership it runs `tenantStorage.run(ctx, () => withTenant(db, ctx, …))` with ctx = {tenantId, actorId: auth.sub, actorRole: membership.role} — the same context `switchTenant` would mint, so RLS narrows every read to what that login would see after a switch (never-list 9 holds by construction). The pattern is `asTenantSystem` in notifications/events.ts:62-69 with the real user instead of system.

CONTRACT (contracts/auth.ts). `MembershipDuesSchema = { tenantId, tenantSlug, displayName, logoUrl, role, outstandingPaise, overduePaise, openBills, lastReceiptAt (datetime|null), lastReceiptPaise (nullable), lastBill: {invoiceNo (nullable), invoiceDate, totalPaise} | null, onTheWay: {stops: int, state: enum(pending,started,arrived), etaAt: datetime|null} | null }`; `MembershipsSummaryOutput = { items: MembershipDuesSchema[], totalOutstandingPaise, totalOverduePaise }`. Staff memberships answer zeros and nulls. Memberships capped at 20 (a login with more is not a shop).

READS, each a plain exported function so auth imports code, not Nest modules (the worker's pattern; boundaries lint allows module→module via index.ts, and nothing imports auth's index, so no cycle):
- receivables/outstanding.ts (owned): `loadOutstandingTotals(tx)` — `sum(outstanding_paise), sum(overdue_paise), sum(open_bills), max(last_receipt_at)` + the paise of that latest receipt over `retailer_outstanding_summary` for `currentTenant().tenantId`; RLS (tenantOrOwnRetailerPolicy, schema/receivables.ts:412) narrows it to the caller's own shops. Export from receivables/index.ts (one line, outside owned files).
- billing: `lastBillForCaller(tx)` — latest `invoices` row by (invoice_date desc, id desc) with state not in (draft, cancelled), projected to {invoiceNo, invoiceDate, totalPaise}; RLS `invoices_read` (schema/billing.ts:135) narrows. ~12 lines in billing/documents.ts + one export line in billing/index.ts (outside owned files: the boundary rule forbids auth reading `invoices` itself).
- delivery: `openStopsForCaller(tx)` — `trip_stops` with state in ('pending','started','arrived'), the same OPEN_STOPS set index.tsx:48 uses today, no join to `trips` (its read policy may exclude the retailer role); answers count, the most advanced state (arrived > started > pending) and the earliest non-null eta. ~15 lines in delivery/performance.ts + one export line (outside owned files, same reason).
- auth: new `backend/libs/core/src/modules/auth/memberships-summary.ts` composing the three per membership; `AuthService.membershipsSummary(auth)` → controller method under `@UseGuards(AccessTokenGuard)`.

APP. index.tsx: one `useQuery(['memberships','summary'], () => api.api.auth.memberships.summary(), {enabled: signedIn, staleTime: 60_000})` (the api-client routes `auth.*` to `authUrl`, client.ts:216). Every card shows its dues chip + outstanding, overdue, last bill, and an 'on the way' line ('A van is at your shop' / 'On the way, expected {when}' / '{n} deliveries coming') with testID `r2-card-<slug>-coming`; the non-open cards keep 'Open {name}'. The panel meta becomes the total: 'You owe ₹{total} across {n} distributors' (testID `r2-total`) replacing `r2.duesElsewhere`; the open tenant's own KPI strip stays. sign-in.tsx: after a successful `signIn`, if `platform.storage` holds `dos.lastTenantId` and it names another ACTIVE membership of this login, call `switchDistributor(stored)` before navigating; `switchDistributor` and sign-in both store the landed tenant id. A session restored from the refresh token already lands where it was (auth_sessions is per tenant), so only a fresh sign-in changes.

### Binding amendments

- (a) The summary handler runs each tenant's reads as the caller's own role under `withTenant` + `tenantStorage.run`; it never uses `withSystem` for tenant rows and never writes `auth_sessions`, `auth_events` or a token. A tenant the user is not an active member of is never queried.
- (b) Module boundaries: auth calls `receivables.loadOutstandingTotals`, `billing.lastBillForCaller`, `delivery.openStopsForCaller` through each module's index.ts; it touches none of their tables. The three helpers take no ids: RLS scopes them, and each reads `currentTenant()`.
- (c) Cost bound (docs/20): at most 20 memberships, one transaction with three small queries each, 60 s client cache; no N+1 over shops (the rollup table is pre-aggregated per shop and summed in SQL).
- (d) `MembershipSummarySchema` on the token pair is NOT widened (sign-in stays cheap); the dues live only on the new read.
- (e) Last-used landing is device-local: `platform.storage` key `dos.lastTenantId`; a stored tenant that is no longer an active membership is ignored, never a 403 shown to the shop.
- (f) Add the PERMISSIONS row and let the auth-service spec's matrix cover it; regenerate READMEs (`pnpm docs:readme`) and add the R2 note to docs/23 ('auth.memberships.summary built').
- (g) Money stays integer paise on the wire; the app formats.

### Files

- `backend/libs/contracts/src/auth.ts`
- `backend/libs/contracts/src/permissions.ts`
- `backend/libs/core/src/modules/auth/auth.service.ts`
- `backend/libs/core/src/modules/auth/auth.controller.ts`
- `backend/libs/core/src/modules/auth/memberships-summary.ts (new)`
- `backend/libs/core/src/modules/auth/auth.spec.ts`
- `backend/libs/core/src/modules/receivables/outstanding.ts`
- `backend/libs/core/src/modules/receivables/index.ts (one export line — outside owned files)`
- `backend/libs/core/src/modules/billing/documents.ts + billing/index.ts (~12 lines + one export — outside owned files: auth may not read invoices directly)`
- `backend/libs/core/src/modules/delivery/performance.ts + delivery/index.ts (~15 lines + one export — same reason)`
- `backend/auth-service/README.md (generated)`
- `frontend/retailer-app/app/index.tsx`
- `frontend/retailer-app/app/sign-in.tsx`
- `frontend/retailer-app/src/strings.ts`
- `docs/23-app-screens-and-api-gaps.md (R2 note)`

### Tests and walks

- auth.spec 'DOS-102: memberships.summary answers dues, last bill and on-the-way per active membership for a login with two retailer memberships, totals them, answers zeros for a staff membership, omits a disabled membership, and never a tenant the user does not belong to (fixtures under withSystem: users, memberships, retailer_links.user_id, retailer_outstanding_summary rows, one issued invoice, one started trip_stop; a third tenant with its own rollup)' — red today (no procedure), green after.
- auth.spec 'DOS-102: the summary needs a Bearer access token (401 without) and writes no auth_sessions or auth_events row'.
- auth-service service.spec permission matrix includes 'auth.memberships.summary' as authenticated.
- receivables spec (in auth.spec via the harness or receivables.spec): 'loadOutstandingTotals under a retailer context sums only that login's shops'.
- Platform walk (web desk 1280, web phone 390, Android, iOS): sign in as ramesh.gupta → R2 shows 35,843 / 26,470 / 29,181 on the three cards and 'You owe ₹91,494.00 across 3 distributors'; Kalyan's card says a van is at the shop; open Sai, sign out, sign in again → lands in Sai.

### Founder question

**After sign-in, where should a shop that buys from several distributors land: in the distributor it used last on that device (the first one on a fresh install) with one home that shows every distributor's dues, live delivery and the total — or on a 'choose your distributor' screen first?**

Recommended default: Land in the distributor used last on that device (first membership on a fresh install) and show one combined home: each distributor's dues, last bill and any van on the way, plus the total owed. No chooser: it would ask a question before showing anything.

- Alternative: A chooser screen before the home (one more tap on every open; the combined home still needed behind it).
- Alternative: Always the first distributor (today's behaviour), with the combined home.

### Notes

Docs/23 R2 already proposed this exact procedure; the architect fixes its home (auth-service, AccessTokenGuard, 'authenticated'). Three module reads (receivables/billing/delivery) are tiny plain functions outside the group's owned files because the module-boundary rule forbids auth reading their tables. No schema change. Build after DOS-103's permissions.ts edit to avoid a second rebase.

## DOS-103 — needs-founder-decision

### Design

ROOT CAUSE. No phone key exists: `TENANT_SETTING_KEYS` (database/src/tenant-bootstrap.ts:121-135) and `SellerBrandingSchema` (contracts/tenancy.ts:149-161) carry name, address, footer, FSSAI and UPI id but no number, so the owner settings screen (owner-app/app/settings/index.tsx:296-326) cannot set one and no retailer screen can show one. `inbound_messages` is FOR ALL staff-only (schema/notifications.ts:220 `tenantRolePolicy('inbound_messages_staff', STAFF_ROLES)`), `notifications.inbound.*` is TRIAGE (permissions.ts:907-908) and the contract has no create (notifications.ts:727-744); returns.tsx:10-15 says so in prose.

DEFAULT BEHAVIOUR (founder to confirm): the shop sees ONE number, the distributor's office number the owner sets in Settings, used for both Call and WhatsApp; 'report a problem / ask for a return' writes a message into the office's inbound triage queue with a kind and the bill or delivery it is about; the desk decides and the credit note follows as today.

CHANGE, in this order.
A. Setting: `TENANT_SETTING_KEYS.brandingPhone = 'branding.phone'` with its doc row ('the number a shop calls or WhatsApps; ABSENT = the app shows no call button'); not seeded by bootstrap; the DEMO seed sets it for the three pilot tenants (seed-demo tenants — outside owned files, three lines, so the dos_qa walk has a number).
B. Contract: `SellerBrandingSchema.phone: z.string().nullable()`; `sellerBranding()` in core/modules/tenancy/branding.ts reads the key (the one constructor; billing's `loadSeller` delegates to it — 2 lines outside owned files).
C. Contract: `InboundKindSchema = z.enum(['return_request','complaint','question'])`; `InboundMessageSchema` gains `kind: InboundKindSchema.nullable()`, `refType: z.enum(['invoice','delivery','order']).nullable()`, `refId: IdSchema.nullable()`; `InboundCreateInput = MutationBase.extend({ id: IdSchema, retailerId: IdSchema, kind: InboundKindSchema, body: z.string().trim().min(1).max(1000), refType?, refId? })` refined so refType and refId come together; `InboundCreateOutput = { item }`; route `inbound.create` POST `/notifications/inbound` ('A shop reports a problem or asks for a return; it lands in the office queue').
D. Permissions: `'notifications.inbound.create': SHOPKEEPER_ONLY`; `'notifications.inbound.list': INBOUND_READERS` = TRIAGE + 'retailer' (new const with the comment: the shop reads back what it sent, RLS narrows it to its own rows; it triages nothing). `markHandled` stays TRIAGE.
E. Schema (expand-only): `inbound_messages` gains `kind text`, `ref_type text`, `ref_id text`, `created_by text references users(id)`, all nullable; policies replaced by `tenantOrOwnRetailerPolicy('inbound_messages_read','retailer_id')` + `...staffWritePolicy('inbound_messages_write')` + `pgPolicy('inbound_messages_shop_insert', {for:'insert', withCheck: tenant match AND actor_role = 'retailer' AND channel = 'in_app' AND created_by = actor_id AND retailer_id IN (own active retailer_links by user_id)})`. Never join retailer_identities (42P17). Migration: `pnpm db:generate` → `00NN_inbound_reports_expand.sql` (columns + policy swap, generated) and hand-written `00NN+1_inbound_reports_guarantees.sql`: CHECK `kind IN (...)` or null, CHECK `(ref_type IS NULL) = (ref_id IS NULL)`, index `(tenant_id, retailer_id, received_at)`, and the DO block asserting FORCE RLS and no FOR ALL policy left on the table; both appended to `_journal.json` at the next free indexes (48/49 unless another lane lands first).
F. Service (inbound.service.ts): `create(input)`: requireRole(['retailer']); `withTenant` → `idempotent(tx, key, input, …)`: `contactPreferences(tx, input.retailerId)` (retailers export) must answer `userId === ctx.actorId` else 403 (RLS would refuse too; the 403 is the clear answer); insert {id, tenantId, channel 'in_app', from: contact.phone ?? 'app', retailerId, body, kind, refType, refId, createdBy, receivedAt now, handled false}; answer `{item}` through `items()`. `list`: requireRole(INBOUND_READERS); the retailer branch of `scope()` returns undefined (RLS narrows) and `unhandledCount` counts its own rows. `toInbound` (notifications.mappers.ts, outside owned files) maps the three new fields.
G. Retailer app: returns.tsx becomes 'Returns & help': a form (Segments kind, TextInput body, optional bill from `?invoiceId=` prefilled by bills/[id].tsx's new 'Report a problem with this bill' button) → `useMutation` on `inbound.create` (invalidates ['inbound']) → Toast 'Sent to {name}'; below it 'Your requests' from `inbound.list({limit:20})` with a chip 'Waiting' / 'Seen by {name}' (handled). Contact: index.tsx (open distributor card), bills/[id].tsx and returns.tsx show a Row of Buttons 'Call {name}' → `links.open('tel:+91…')` and 'WhatsApp' → `links.open('https://wa.me/91…')` only when `tenancy.branding.get().phone` is set (ANY_MEMBER, one cached query `['tenancy','branding']`); digits normalised on the client (strip non-digits, prefix 91 for a 10-digit number).
H. Owner app: settings/index.tsx adds a TextInput `branding.phone` ('Phone number shops call') under the UPI address, saved by the existing `settings.set` batch; owner strings `o24.phone`.
I. Manager app messages/index.tsx (outside owned files, display only): the inbound register gains a 'Kind' column ('Return request' / 'Complaint' / 'Question' / '—') and the reference number when present, so the desk recognises a shop's report among WhatsApp texts.

### Binding amendments

- (a) The shop's message is stored raw and never edited; `kind`, `refType`, `refId` carry the structure. The desk still only flips `handled`.
- (b) The insert policy admits the retailer role for `channel = 'in_app'` and its own linked shop only; a shop can never insert a `whatsapp`/`sms` row, a row for another shop, or update/delete any row. Staff write policies keep the WhatsApp webhook (system role) working.
- (c) Never join `retailer_identities` in a policy; scope through `retailer_links.user_id` (columns.ts tenantOrOwnRetailerPolicy).
- (d) Migrations are expand-only: generated expand file + hand-written guarantees sibling whose DO block fails if `inbound_messages` lacks FORCE RLS or still carries a FOR ALL policy; take the next free `_journal.json` index at build time.
- (e) The new setting key is `branding.phone`; it is not `secret.*`, so staff read it and only the owner sets it (`settings.set` OWNER_ONLY). The retailer reaches it only through the service-mediated `branding.get`.
- (f) Show no Call/WhatsApp button when the phone is absent; a dead button is worse than none.
- (g) Extend rls.test.ts for the new policies and update the existing 'keeps inbound texts … to staff' test (rls.test.ts:5295) and the write loop at ~5196 that assumes a retailer cannot insert into inbound_messages.
- (h) Update any pinned literal list of retailer-callable procedures in the specs (the DOS-037 pattern) and regenerate READMEs; `pnpm smoke` stays 0 BROKEN (the example for `inbound.create` must use a demo shop linked to the smoke retailer login).

### Files

- `backend/libs/database/src/tenant-bootstrap.ts`
- `backend/libs/database/src/seed-demo/tenants.ts (three demo phone rows — outside owned files)`
- `backend/libs/contracts/src/tenancy.ts`
- `backend/libs/core/src/modules/tenancy/branding.ts (2 lines — the one SellerBranding constructor, outside owned files)`
- `backend/libs/contracts/src/notifications.ts`
- `backend/libs/contracts/src/permissions.ts`
- `backend/libs/database/src/schema/notifications.ts`
- `backend/libs/database/migrations/00NN_inbound_reports_expand.sql (generated) + 00NN+1_inbound_reports_guarantees.sql (hand-written)`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/database/src/rls.test.ts`
- `backend/libs/core/src/modules/notifications/inbound.service.ts`
- `backend/libs/core/src/modules/notifications/notifications.controller.ts (one @Implement — outside owned files)`
- `backend/libs/core/src/modules/notifications/notifications.mappers.ts (3 fields — outside owned files)`
- `backend/libs/core/src/modules/notifications/notifications.spec.ts`
- `backend/libs/core/src/modules/tenancy/tenancy.spec.ts (branding.phone assertion — outside owned files)`
- `frontend/retailer-app/app/returns.tsx`
- `frontend/retailer-app/app/bills/[id].tsx`
- `frontend/retailer-app/app/index.tsx`
- `frontend/retailer-app/src/strings.ts`
- `frontend/owner-app/app/settings/index.tsx`
- `frontend/owner-app/src/strings.ts`
- `frontend/manager-app/app/messages/index.tsx + manager strings (display-only kind column — outside owned files)`
- `backend/*-service/README.md (generated)`

### Tests and walks

- notifications.spec 'DOS-103: a shop files a return request against its own bill through inbound.create; it lands in inbound.list for the desk with kind, reference and the shop's phone as sender; the shop lists only its own reports and cannot mark one handled; a report naming another shop is 403; a replay with the same idempotencyKey adds nothing' — red today (no procedure), green after.
- tenancy.spec 'DOS-103: branding.get answers phone null until the owner sets branding.phone, then the number, for the retailer role too' — red today (no field).
- rls.test.ts 'DOS-103: a shop inserts an in_app report for its own shop only; it reads its own reports and never another shop's texts; it cannot flip handled or insert a whatsapp row; every staff role still reads the whole queue and the worker still inserts' — red today (retailer insert refused), green after.
- retailer- and manager-service service.spec permission matrices cover 'notifications.inbound.create' (retailer only) and the widened 'inbound.list'.
- Platform walk (web desk 1280, web phone 390, Android): owner sets the phone in Settings → retailer R2 and R4 show Call and WhatsApp (Android: the dialler opens; web: a tel: hand-off); R4 → 'Report a problem with this bill' → returns screen prefilled → Sent → the report shows in manager M18 inbound with kind and shop, and on the shop's 'Your requests' as Waiting; manager marks it handled → the shop sees 'Seen'.

### Founder question

**Which number should a shop see and tap in the app — one office number the owner sets in Settings (used for both Call and WhatsApp), or the shop's own salesperson's number? And should 'report a problem / ask for a return' land as a message in the office's inbound queue for the desk to act on, or become a return request the delivery crew picks up at the next visit?**

Recommended default: One office number set by the owner in Settings, for Call and WhatsApp; the report lands in the office's inbound queue with its kind and the bill or delivery it names, the desk triages it, and the credit note is raised as today (at the door or by the desk).

- Alternative: Show the shop's own salesperson's number (needs the beat assignment per shop and exposes staff personal numbers to customers; the office number can still be added later as a second button).
- Alternative: A first-class return request the crew acts on at the next visit (a new aggregate with a crew screen and a state machine — a module slice, not a batch-2 fix).

### Notes

This is the group's only schema change; build it FIRST in the group so DOS-102's permissions.ts edit and READMEs rebase once. The report gives the desk no push notification in this batch (the M18 badge and unhandledCount show it); a `shop_report` staff notice is a follow-up if the desk misses them. dos_qa must be re-migrated and re-seeded after this lands.

## DOS-104 — design-ready

### Design

ROOT CAUSE. frontend/retailer-app/app/order.tsx:260-290 quotes the whole listed catalogue at qty 1 through `pricing.quote` (`listQuote`) to print the shop's standing rate per row; each `QuotedLine` (contracts/pricing.ts:307-341) now carries applied rules, free items and GST (DOS-096), so 171 rows are ~55 KB for four numbers each. The 500-row `inventory.stock.sellable` half of the finding is already gone on main: R7 reads `inventory.stock.availability` (DOS-097, retailer-app/src/lib/stock.ts). Serving a rate on `tenantCatalog.list` is not possible without a second engine: tenant-catalog is upstream of pricing in the module order and may not call it.

CHANGE. One slim read on the pricing module that is a PROJECTION of the one engine, never a tier lookup of its own:
1. Contract (contracts/pricing.ts): `RatesInput = { retailerId: IdSchema, pricingDate?: IsoDateSchema }`; `RateItemSchema = { variantId, caseSize, listRatePaise, ratePaise }`; `RatesOutput = { retailerId, pricingDate, items: RateItemSchema[] }`; `pricing.rates` GET `/pricing/rates` ('The shop's standing per-piece rate for every listed item: the engine at one piece, nothing else'). No variant list on the query string (500 ids would not fit a URL): the rate list IS the listed catalogue.
2. Permissions: `'pricing.rates': ANY_MEMBER` beside `'pricing.quote'`.
3. Service (quote.service.ts): `rates(input)`: requireRole([...STAFF,'retailer']); withTenant → `loadRetailer` (the same 403 for a shop that is not the caller's, quote.service.ts:174); listed variant ids from tenant-catalog through a new plain export `listedVariantIds(tx, limit = 1000)` in tenant-catalog.service.ts (+ one export line in its index.ts; tenant-catalog is upstream of pricing so the import is legal); then `this.quoteInTx(tx, ctx, { retailerId, pricingDate, lines: ids.map(v => ({ lineId: v, variantId: v, qtyPcs: 1 })) })` and project `{ variantId, caseSize, listRatePaise, ratePaise }` from each quoted line. An empty catalogue answers `items: []`. Chunk the ids at 500 (QuoteInput's max) and concatenate.
4. Controller (pricing.controller.ts, outside owned files): one `@Implement(contract.pricing.rates)` method with `@OwnsReply()`.
5. App (order.tsx): replace `listQuote` with `useQuery(['rates', retailerId, today()], () => api.api.pricing.rates({ retailerId, pricingDate: today() }), { enabled, staleTime: 300_000 })`; `listRates` becomes a Map of RateItem; the row's per-piece figures read `ratePaise`/`listRatePaise` as before; the basket quote (the debounced `quote`) is untouched. Delete the 'quoted ONCE at one piece' comment block in favour of one naming `pricing.rates` as the engine's projection.
6. READMEs regenerated; docs/23 R7 note: `pricing.rates` ✓.

### Binding amendments

- (a) `rates` MUST go through `quoteInTx` → `priceOrder()`; it must not read price lists, overrides or bargains on its own. A parity spec pins it: for every listed variant, `rates.items[v].ratePaise === quote({lines:[{v, qty 1}]}).lines[0].ratePaise` and the same for listRatePaise, on a shop with a tier list, a retailer override, an approved bargain and a final override.
- (b) The shop's own-shop rule (`loadRetailer` 403) and RLS apply exactly as on `quote`; a retailer login rates only its linked shop.
- (c) The read is bounded: listed variants only, at most 1000, chunked at QuoteInput's 500; payload ≤ ~80 bytes per item. No pagination in this batch.
- (d) The basket quote stays the only source for scheme, free-quantity and GST figures on a row; `rates` never shows a scheme effect (qty 1) and the screen must not pretend otherwise.
- (e) Verify on the network capture that R7 open makes exactly: tenantCatalog.list, the availability pages, pricing.rates — and no POST /pricing/quote until a quantity is set and no /inventory/sellable.

### Files

- `backend/libs/contracts/src/pricing.ts`
- `backend/libs/contracts/src/permissions.ts`
- `backend/libs/core/src/modules/pricing/quote.service.ts`
- `backend/libs/core/src/modules/pricing/pricing.controller.ts (one method — outside owned files)`
- `backend/libs/core/src/modules/pricing/pricing.spec.ts`
- `backend/libs/core/src/modules/tenant-catalog/tenant-catalog.service.ts`
- `backend/libs/core/src/modules/tenant-catalog/index.ts (one export line — outside owned files)`
- `backend/*-service/README.md (generated)`
- `frontend/retailer-app/app/order.tsx`
- `docs/23-app-screens-and-api-gaps.md (R7 note)`

### Tests and walks

- pricing.spec 'DOS-104: pricing.rates answers one row per listed variant whose ratePaise and listRatePaise equal a qty-1 pricing.quote for the same shop and date — tier list, retailer override, approved bargain and a final override included — answers [] for an empty catalogue, and a retailer login rates only its own shop (403 for another)' — red today (no procedure), green after.
- retailer-, sales-, manager-, owner-, delivery-, warehouse-service service.spec permission matrices cover 'pricing.rates' as ANY_MEMBER.
- Platform walk (web desk 1280 with the network panel, web phone 390, Android): open R7 → one GET /pricing/rates under 20 KB for 171 items, no POST /pricing/quote, no /inventory/sellable; per-piece rates still print on every row; set a quantity → the basket quote fires and the scheme shows.

### Notes

Depends on DOS-096 and DOS-097, both merged on main in batch 1. The stock half needs nothing more. Server-side cost is unchanged (the engine is a pure function over ~171 lines); the win is 55 KB → ~12 KB and one round trip fewer on a 4G counter phone, and the quote payload can keep growing without the price list paying for it.

## DOS-125 — design-ready

### Design

ROOT CAUSE. frontend/retailer-app/app/pay.tsx:205-207 and dues.tsx:247-249 print `upiQrPayload` / `payload` as a `Txt numeric` line: the kit has no QR component (types.ts §6.14 lists four charts), the web `Txt` (web/base.tsx:38-70) sets no `overflow-wrap`, so an unbreakable 120-char string clips at 390 px, and `links.web.ts:8-19` answers `true` after `window.open`/`location.href` whatever the browser did, so `noUpiApp` (pay.tsx:55, 190) can never show on web. The platform layer offers `share` and `links` only; there is no clipboard.

KIT CONTRACT.
1. types.ts: `export interface QrCodeProps extends Testable { value: string; size?: number | undefined; label?: string | undefined }` — value is encoded in byte mode at error-correction level M, up to 1 000 characters; size in px including the 4-module quiet zone, default 216; label is the accessible name ('UPI QR for ₹4,561'). Always black modules on a white tile, in both themes — a scanner needs contrast, not a theme.
2. Shared encoder `frontend/libs/ui/src/qr.ts` (platform-neutral; the ONLY import site of the library): `qrPath(value): { modules: number; d: string }` — one SVG path (`M x y h1 v1 h-1 z` per dark module) both renderers draw, computed with `qrcode-generator@1.4.4` (zero dependencies, pure JS, MIT; `typeNumber 0` auto-sizes, `'Byte'` data, EC 'M'). Pinned in `frontend/pnpm-workspace.yaml` catalog and listed under `dependencies` in `libs/ui/package.json` (it bundles like any JS; not a peer). Throws on an empty value.
3. Renderers: web/charts.tsx `QrCode` → `<svg viewBox="0 0 N N" width height role="img" aria-label shape-rendering="crispEdges" data-testid><rect fill="#fff"/><path d fill="#000"/></svg>`; native/charts.tsx `QrCode` → react-native-svg `<Svg viewBox><Rect/><Path/></Svg>` with `accessibilityLabel`. Both barrels (web/index.ts, native/index.ts) export `QrCode`; parity.test.ts passes by construction.
4. `TxtContract.wrap?: 'anywhere' | undefined` — web: `overflowWrap: 'anywhere', wordBreak: 'break-all'`; native: documented no-op (RN Text already breaks an over-long word at any character). Added in web/base.tsx and native/base.tsx (outside the owned list; the Txt contract is in types.ts which is owned).
5. Platform (`platform/types.ts`): `PlatformLinks.confirmsHandoff: boolean` — web `false` ('a browser cannot tell whether anything took a upi:// URL; `open` still answers true'), native `true` (`Linking.openURL` rejects when nothing handles the scheme, links.native.ts:12-20). New pair `clipboard.web.ts` / `clipboard.native.ts` exporting `clipboard: PlatformClipboard { copy(text: string): Promise<boolean>; readonly available: boolean }` — web: `navigator.clipboard.writeText` when `window.isSecureContext` and the API exists (localhost and 127.0.0.1 count as secure), else `available: false`; native: `available: false`, `copy` answers false — no `expo-clipboard` in this batch (the phone has 'Open a UPI app' and a scannable QR; a native Copy is a later SDK-pinned addition). Add `clipboard` to the `Platform` interface, to both platform barrels, and to the explicit pair list in parity.test.ts ('camera','clipboard',…).

SCREENS.
6. pay.tsx r5-intent: `<QrCode value={intent.upiQrPayload ?? intent.upiIntentUrl} size={216} label={t('r5.qrLabel',{amount})} testID="r5-qr" />` centred above the Money; the raw string as `Txt … wrap="anywhere" testID="r5-intent-string"`; a `Button` 'Copy' (`r5-copy`) shown only when `clipboard.available`, answering an inline 'Copied' Txt for 2 s; under 'Open a UPI app', when `!links.confirmsHandoff`, a static hint `r5-web-hint`: 'On a computer, scan the QR with your phone's UPI app, or pay {vpa} and quote the reference below.' The native `r5-no-upi-app` path stays.
7. dues.tsx r3-qr-sheet: `<QrCode value={qr.data.payload} … testID="r3-qr-image" />` above the Money; the payload with `wrap="anywhere"`; the same Copy button (`r3-qr-copy`).
8. Strings: r5.qrLabel, r5.copy, r5.copied, r5.webHint; r3.qrLabel.

### Binding amendments

- (a) Screens import `QrCode` from `@dos/ui` and `clipboard`/`links` from `@dos/ui/platform` only — never `react-native-svg` or a QR library directly (ESLint enforces the first; the design forbids the second).
- (b) `qr.ts` is the only module that imports `qrcode-generator`; both renderers consume `qrPath`, so swapping the encoder later is one file.
- (c) The QR tile is always #fff with #000 modules, quiet zone 4 modules, `shape-rendering: crispEdges`; no theme token, no rounded corners, no logo overlay.
- (d) The web hint is static (rendered from `links.confirmsHandoff === false`), never from the result of `links.open`; `links.web.open` keeps answering true as documented.
- (e) `clipboard.native` must be honest: `available: false` and the screens hide Copy; do not fake it with the share sheet.
- (f) Catalog changes go through `frontend/pnpm-workspace.yaml` (qrcode-generator 1.4.4 under dependencies; jsqr 1.4.0 as a devDependency of libs/ui for the decode test) followed by `pnpm install` in frontend so pnpm-lock.yaml changes; nothing Expo-pinned moves.
- (g) Every new kit export has the same name on web and native (parity.test.ts) and every new platform capability is a .web.ts/.native.ts pair.

### Files

- `frontend/pnpm-workspace.yaml`
- `frontend/libs/ui/package.json`
- `frontend/pnpm-lock.yaml`
- `frontend/libs/ui/src/types.ts`
- `frontend/libs/ui/src/qr.ts (new)`
- `frontend/libs/ui/src/qr.test.ts (new)`
- `frontend/libs/ui/src/web/charts.tsx`
- `frontend/libs/ui/src/native/charts.tsx`
- `frontend/libs/ui/src/web/index.ts + src/native/index.ts (barrel export lines — outside owned files, unavoidable)`
- `frontend/libs/ui/src/web/base.tsx + src/native/base.tsx (Txt wrap — outside owned files; the contract lives in types.ts)`
- `frontend/libs/ui/src/platform/types.ts`
- `frontend/libs/ui/src/platform/links.web.ts`
- `frontend/libs/ui/src/platform/links.native.ts (one field — outside owned files)`
- `frontend/libs/ui/src/platform/clipboard.web.ts + clipboard.native.ts (new)`
- `frontend/libs/ui/src/platform/index.web.ts + index.native.ts (barrel lines — outside owned files)`
- `frontend/libs/ui/src/parity.test.ts`
- `frontend/retailer-app/app/pay.tsx`
- `frontend/retailer-app/app/dues.tsx`
- `frontend/retailer-app/src/strings.ts`

### Tests and walks

- libs/ui qr.test.ts 'DOS-125: the module grid of a upi://pay intent decodes back to the same string (jsQR over the grid rasterised at 4 px per module with a quiet zone), a 1 000-character value still encodes, an empty value throws, and the path has one square per dark module' — red today (no qr.ts), green after.
- parity.test.ts: 'clipboard' in the pair list and `QrCode` exported by both renderers — red today, green after.
- libs/ui web render test (existing jsdom harness, e.g. web/charts.test.tsx): `<QrCode>` renders an svg with role img, the label, a white rect and one path — red today.
- Platform walk web 1280 and 390 (Money due → Pay this bill; Pay everything → Start the payment): a QR is visible on r3-qr-sheet and r5-intent, scanned with a real phone's UPI app it shows the distributor's VPA and the amount; the intent string wraps inside 390 px with no horizontal overflow (measure); r5-web-hint visible; Copy puts the string on the clipboard on http://localhost. Android and iOS: pay.tsx renders the QR, Copy is absent, 'Open a UPI app' behaves as before (no-app hint on an emulator without a UPI app).

### Notes

Overlaps DOS-124 only on pay.tsx; rebase on lean-retailer-shop before touching it. The R3 sheet's QR is the amount still due now (billing.invoices.upiQr), which is what a counter PC should show a paying phone. No backend change.

