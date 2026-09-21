# Data, Security & Multi-tenancy

## Document Information

| Property     | Value                          |
| ------------ | ------------------------------ |
| Document     | Data, Security & Multi-tenancy |
| Product      | Distribution OS                |
| Version      | 3.0                            |
| Status       | Active                         |
| Owner        | Product Management             |
| Last Updated | 21 September 2026              |

---

# Purpose

This page is the single description of **who can reach which data, and what stops them when the application code is wrong**. It covers the tenancy model, row-level security, the seven roles and the permission matrix, role election at sign-in, what each role can never see, authentication, the audit trail, retention, the white-label settings keys, and the privacy commitments.

Every statement traces to the repository: `docs/22-source-of-truth.md` (source of truth and its dated decisions register, §7 sign-in and §9 never-list), `docs/29-sign-in-roles-and-one-store-app.md` (sign-in, role election and the one store app), `CLAUDE.md`, `docs/04-system-architecture-and-data-model.md` (ADRs 0001–0008), `docs/17-corrections-from-review.md` §B, `docs/20-scale-rules.md`, `docs/18-build-log.md` and `QA/STATE.md` for build state, and the code named in each section.

**Decided 2026-09-05:** the repository is the source of truth and Confluence mirrors it. Where an older Confluence page disagrees with this one, this one wins.

**Where the product is, as at 2026-09-21.** **Backend and frontend are both complete.** Eight services, 57 database migrations, 646 backend module specs, and **all seven apps built and independently gated** — each one walked screen by screen against the live services and the pilot database (`docs/18-build-log.md`, 2026-09-07). The line that stood here through the last sync — "no app screen is built yet" — has been false since that date. The most recent full endpoint sweep is **1,618 calls ending 0 BROKEN on a fresh seed** (`QA/10-DAY-PLAN.md`); from **2026-09-21** that sweep is worked failure by failure rather than as an all-or-nothing bar, on the founder's instruction.

What is running now is **quality assurance and the path to go-live**: QA batch 2 is merged (153 of 158 findings), and a **seven-day plan targets live on Saturday 27 September** if Thursday evening's books balance (`QA/STATE.md`, `QA/10-DAY-PLAN.md`). Almost every security rule added to this page in this revision came out of that QA work — each one found by somebody driving the product as a real person would, not by review.

---

# 1. The security model in one paragraph

Security is layered, and the outer layers are allowed to fail. A role can only reach the **service** its app talks to; inside that service the **permission matrix** decides every endpoint before any business logic runs; inside the database **row-level security** decides every row, and it is enabled _and forced_, so it applies even to the connection that owns the schema. The database layer is the guarantee — the two above it exist to give a clear 403 and a readable audit trail. Anything that must never leak (purchase cost, margin, credit terms, another distributor's rows) is protected at the database layer with a test that proves it.

**One addition since the last sync, and it matters more than it sounds.** The offline door is now held to the same standard as the front door: **every operation a device uploads is checked against the same permission matrix** (decided 2026-09-13, §5). Before that, "the salesperson never records a receipt" was true of the endpoint and untested of the queue.

---

# 2. Tenancy model

**One tenant = one distributorship.** Every tenant table carries `tenant_id`; every index leads with it.

**Decided 2026-09-05: branches are not modelled in v1.** A distributorship has many warehouses, vehicles, beats and teams inside one tenant. Multi-branch is a v2 topic and the shape then is _one tenant per branch plus an owner group view_. This supersedes the older Confluence statement that "multiple branches" is an enterprise capability (`docs/24` C8).

| Data class          | Examples                                                       | Scoping                                                                   |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Tenant data         | retailers, orders, invoices, stock, ledgers, trips, settings   | `tenant_id` on every row, RLS forced                                      |
| Global curated data | manufacturers, brands, products, variants, HSN rates           | No `tenant_id`; readable by all, writable only by a curator or the system |
| Global identity     | users (one person, one login), retailer identities (one phone) | Keyed by user; memberships link a user to each tenant they work in        |

A person is global; their **membership** is per tenant and carries the role. A shopkeeper therefore has one login and can be linked to several distributors — the demo data deliberately includes **shops linked to more than one distributor** (founder requirement, 2026-09-04), and the retailer app shows one card per linked distributor. **Decided 2026-09-13:** such a shop lands in the distributor it used last on that device (a fresh install lands in the first), and one home shows each distributor's dues; there is no "choose your distributor" screen.

## 2.1 How every request is scoped

All tenant data access goes through `withTenant(db, ctx, fn)`. It opens a transaction, runs `SET LOCAL ROLE app_rw` (so even the schema-owning connection is subject to RLS) and sets `app.tenant_id`, `app.actor_id` and `app.actor_role` as transaction-local settings, which every policy reads. Because all of it is `SET LOCAL`, a transaction-mode connection pooler in front of Postgres is safe (`docs/20` rule 11). The tenant context lives in `AsyncLocalStorage` for the request; asking for it outside a guarded request throws rather than defaulting. `/health` is the only unguarded route.

Three database roles: the migration owner (schema changes and seeds), `app_rw` (every service and every request — **no `BYPASSRLS`**), and `app_worker` (`BYPASSRLS`, used only by deliberately cross-tenant background jobs: outbox relay, retention sweeps, rollups).

**That third role decides where the product is hosted.** Creating `app_worker` with `BYPASSRLS` requires a Postgres superuser, and no free managed Postgres grants one — Neon, Supabase and RDS all withhold it. The verified conclusion (2026-09-21, `QA/STATE.md`): **Postgres 17 is self-hosted** on an Oracle Cloud Always Free instance in the Mumbai region, with the seven apps on Cloudflare Pages and the domain `distributionos.in`. The isolation model is not bent to fit a hosting bill.

---

# 3. Row-level security

RLS is `ENABLE` **plus** `FORCE` on every tenant table — forcing is what makes the policy apply to the table's owner as well. Adding a table without its forced-RLS line is caught by a test that enumerates every table carrying `tenant_id` and asserts both the force flag and at least one policy.

Policies are written as reusable helpers (`backend/libs/database/src/schema/columns.ts`) rather than hand-rolled per table:

| Helper                                           | Rule                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `tenantPolicy`                                   | Any active member of the tenant may read and write the row                                                   |
| `tenantRolePolicy(name, BACK_OFFICE_ROLES)`      | Owner, manager, accountant and system only — used on **every table that carries purchase cost or the books** |
| `tenantOrOwnRetailerPolicy` + `staffWritePolicy` | A shopkeeper reads only rows linked to their own shop, and writes none of them                               |
| `globalCuratedPolicies`                          | Global catalog: everyone reads, only a curator or the system writes                                          |
| `roleReadPolicy`                                 | Read restricted to a named role list (audit log, journal entries and lines)                                  |

Tables under the back-office-only policy today include `tenant_product_costs`, purchase orders, supplier invoices and their lines, write-offs, all six Tally/import/export tables, all seven document-intelligence tables, claims and computed payouts. `tenant_settings` is narrower still: **owner only**.

Two implementation rules worth keeping: a policy on a tenant table must never join the global retailer identity table (Postgres reports infinite recursion, 42P17 — the shop link is denormalised onto the row instead), and field-limiting views such as `sellable_stock` are created `security_invoker = true` so the caller's policies still apply through the view.

**Added 2026-09-13:** the database now carries its own line on receipts, independent of any service — **only the owner, manager, accountant, delivery crew and the system may insert one**. The rule "the salesperson never collects" is therefore true at the last layer, not only at the first.

---

# 4. Roles and the permission matrix

Seven membership roles exist in code: **owner, manager, accountant, salesperson, warehouse, delivery, retailer**. **`platform_admin`** — staff of Distribution OS itself — is a separate enum with no membership and no tenant, so a tenant role can never satisfy an `admin.*` rule and a platform admin can never satisfy a tenant rule. Two further platform roles sit on the user record: **curator** (global catalog) and **support**.

**Decided 2026-09-04: one app per role, one backend service per app**, so a role cannot even reach an endpoint its service does not mount — the guard answers 403 for a role the service does not serve, before any business logic. **Decided 2026-09-05:** a seventh **platform-admin** app and service (`admin-service`, port 3007) for distributor onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access. **Both are built and gated** (2026-09-07); this page's earlier "not built yet" no longer applies.

**Decided 2026-09-12 — the console has three levels, and the server enforces them on every console action.** The token's role is always `platform_admin`; the level narrows it:

| Console level | May do                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| super         | Everything: onboard, suspend, reactivate, plans, lock and unlock logins, support access                |
| support       | Read everything; ask for and hand back support access to a distributor; **nothing else**               |
| billing       | Read everything; change a distributor's plan; **nothing else**                                         |

**The permission matrix** (`backend/libs/contracts/src/permissions.ts`) is one table: procedure path → who may call it. It carries **375 rows today, one per declared procedure** (250 at the last sync; the product has grown, the rule has not). Its properties:

- **Fails closed.** The guard refuses any path with no row, so the failure mode of a forgotten entry is "nobody can call it", never "anybody can".
- **Complete and tested.** A spec asserts every contract procedure has a row, that no row names a procedure that does not exist, and that only real roles appear; the endpoint × role behaviour is then exercised against a running service.
- **Enforced on the offline route too.** Since 2026-09-13 every operation arriving through `/sync/upload` is checked against the same matrix before anything is written (§5).
- **Published.** Every operation in Swagger and Scalar is annotated with `x-roles`, and the generated service READMEs render the same table.
- **Not customisable per tenant.** This supersedes the older Confluence line that "permissions are role-based and can be customized by each organization" (`docs/24` C7). Roles, approval kinds and state machines are fixed product surface; what a distributor configures is listed in §8.

Role groups are declared by _power_, not by convenience, so they can drift apart later:

| Group              | Roles                                | What it gates                                                                 |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `BACK_OFFICE`      | owner, manager, accountant           | Purchase cost, the books, the audit trail                                     |
| `MANAGEMENT`       | owner, manager                       | Prices, schemes, credit terms, approvals, order confirmation, catalog overlay |
| `MONEY_DESK`       | owner, manager, accountant           | Office receipts, deposits, bounces, allocations, write-offs, exports          |
| `MONEY_COLLECTORS` | owner, manager, accountant, delivery | Recording a payment from a shopkeeper                                         |
| `DUES_READERS`     | + salesperson, retailer              | Seeing what a shop owes                                                       |
| `STOCK_KEEPERS`    | owner, manager, warehouse            | Physical stock, picking, packing, counts                                      |
| `PIN_HOLDERS`      | owner, manager                       | Cancelling a numbered document, releasing a hold, approving load-out          |
| `OWNER_ONLY`       | owner                                | Settings, numbering series, feature flags, tenant legal identity              |

**Decided 2026-09-05 — accountant scope is money desk plus reads.** The accountant may record office receipts, bank cheques, mark bounces, allocate, write off and take every export, and may read everything. The accountant sets **no** price, scheme, credit limit, approval, setting or numbering series. This supersedes the Confluence persona line giving the accountant credit approvals (`docs/24` C5).

**Decided 2026-09-05 — the manager's PIN for load-out is given in the manager app.** The manager approves the load sheet from their own device; the warehouse device waits for that approval. Nothing is typed on the warehouse phone.

## 4.1 Role election at sign-in, downward only (decided 2026-09-21)

Real distributorships do not hold still: the owner drives some mornings, the warehouse man delivers on Tuesdays. Until now a membership was one (person, distributor, role), so an owner opening the delivery app got a 403 and a screen saying so.

**The wrong fix would have been to let an owner token into the field apps.** A van phone is a shared, droppable device; an owner token on it reaches owner-service — every margin, every setting — for the life of its refresh token. That would throw away the reason seven services exist.

**What was decided instead:** a device asks for the role it needs, and the auth service grants it **only downward**. The table is fixed in code, not configurable in v1:

| Membership role                                  | May act as                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| owner                                            | manager, accountant, warehouse, delivery, salesperson             |
| manager                                          | warehouse, delivery, salesperson                                  |
| accountant, warehouse, delivery, salesperson     | own role, plus each role in the membership's `extra_roles`        |
| retailer, platform_admin                         | never anything else                                               |

The rules that make this safe rather than convenient:

- **The access token carries the _elected_ role; `sub` stays the person.** Every audit row, every `actor_id`, every receipt and every delivery therefore records _who_ did it — the token only says _as what_. `auth_events` gains `acted_as`, so a sign-in as a lower role is visible to the owner.
- **Nothing on the server changes.** Services keep their role lists, the permission matrix keeps its rows, and RLS reads `app.actor_role` = the elected role exactly as it does today. This is a change to what a _device_ may ask for, not to what the server allows.
- **An owner token never enters a field app.** Election is downward only, so the strongest key on a van phone is the field role it elected.
- **A refused election is a 403 at sign-in with a sentence a person can act on**, never a silent downgrade: _"Your login at Tarsun is a salesperson; ask the owner to add delivery to it."_
- **Extra roles** are set by the owner or the manager on the staff screen. The manager cannot grant owner or manager; only the owner can.
- The salesperson still never collects money, the retailer only ever acts as a retailer, and the warehouse role still cannot depart a trip. No election can produce any of those.

Design: `docs/29-sign-in-roles-and-one-store-app.md` §2. **Decided 2026-09-21:** role election, and the merge of the six business apps into one app for the phones _and_ the website, land **before** go-live rather than after it, so what the business simulation proves is what ships.

---

# 5. What each role can never see, and what each role can never do

These are the non-negotiables from `docs/22` §9. Each is a database policy with a test, not an application convention.

| Never visible to                           | What                                                                           | Enforced by                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Salesperson, warehouse, delivery, retailer | Purchase cost, landed cost, price-to-distributor, margin                       | Back-office policy on `tenant_product_costs`, supplier invoices and purchase orders                  |
| Salesperson, warehouse, delivery, retailer | The journal, the chart of accounts, write-offs                                 | `roleReadPolicy` on journal tables; back-office policy on write-offs                                 |
| Retailer                                   | Credit limit, credit mode, credit-available figure, tier, internal shop code   | Absent from every retailer-role contract and from the retailer write policy                          |
| Retailer                                   | The office's reason for holding an order, and any shortfall on it              | `credit_notice` and `stock_shortages` are office-only columns, omitted for the retailer role (2026-09-21) |
| Retailer                                   | Another shop's bills, orders, deliveries, proofs; any trip, cash or coordinate | Own-retailer policy narrowed to the shop's own link                                                  |
| Salesperson                                | Recording a receipt of any kind                                                | **Decided 2026-09-04:** the sales service mounts no receipt endpoint, the matrix never grants one, and since 2026-09-13 the database refuses the insert |
| Salesperson                                | Scheme funding source, claimability and claim windows                          | Reps read schemes through a view without those columns                                               |
| Salesperson, warehouse, delivery, retailer | The audit trail (before/after of a price or credit edit)                       | `roleReadPolicy('audit_log_read', BACK_OFFICE_ROLES)`                                                |
| Any tenant                                 | Any other tenant's rows                                                        | `tenant_id` predicate in every policy, forced RLS                                                    |

Two clarifications that are often read the wrong way. First, the rule is "**the salesperson never collects**", not "never sees": a rep _does_ see a shop's outstanding on the beat screen and _does_ run the pre-order credit check — three receivables reads carry the rep, and no write does. Second, purchase price can leak through a _picture_, so supplier-invoice pages and cost-bearing documents are excluded from field-role streams and the signed-URL procedure checks the document's domain against the caller's role (§9).

## 5.1 What each role can never do (added since the last sync)

Four rules decided during QA. Each closes a door that a permission table alone had left ajar.

| Rule                                                                                                                                                                                                                                | Decided    | Reference          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------ |
| **A warehouse, delivery or accountant login cannot create, repeat, re-line, submit or cancel an order** — online _or_ by device upload. All three still read orders. The five order writes belong to the owner, the manager, the salesperson and the shop; the crew sells from the van only through Van sale. | 2026-09-13 | QA DOS-115         |
| **Every offline upload is checked against the permission matrix.** A role that may not make a change through the normal endpoint cannot make it through `/sync/upload` either: the operation is refused before anything is written, as a recorded `role_not_allowed` rejection — never silently, and never as a 500. A write the database policy refuses is recorded as `not_permitted`. | 2026-09-13 | QA DOS-166 (P0)    |
| **Only the owner and the manager add stock or record opening stock.** Every other role records a _count_, and new stock arrives only through a goods receipt. The accountant views inbound documents, supplier invoices, goods receipts and stock without changing anything there, and may still capture a supplier bill. | 2026-09-13 | QA DOS-037, DOS-044 |
| **A shop's credit limit and the office's reasons never reach the shop's own device.** The `credit_notice` and `stock_shortages` columns were reaching a retailer device through the sync pull; the read is now narrowed for that role at its only door, and the device re-snapshots on the new schema. The shop is still told _that_ its order is with the distributor — a gate name, never a figure. | 2026-09-21 | QA, sales/orders/pricing lane |

## 5.2 Three non-negotiables added since the last sync

These are `docs/22` §9 items 11, 12 and 13. Two of them are about honesty rather than access, and they are held to exactly the same standard.

- **Never-list 11 — sign-out leaves nothing of the previous user or distributor on a device.** Each person, in each distributorship, gets their own offline copy on the phone or browser; it is checked before anything is shown and deleted at sign-out, and the online cache and the order draft follow the same rule. Unsent changes at sign-out stay on that phone **for that person only** and go first the next time that person signs in there — nobody else can see or send them, and nothing is thrown away (founder's answer, 2026-09-13). Closed and measured on Android, iOS and the browser on 2026-09-20.
- **Never-list 12 — the app never tells someone their work is saved when it is not.** When a browser or phone cannot keep an offline copy, _every_ screen says so — not just the first — and no button reads "Saved on this phone" over work that dies with the tab. An order saved with no signal keeps saying so until the office actually confirms it; it never re-labels itself "Order placed" because the signal came back. One rule in code decides every sentence that claims the device keeps something, and a repository-wide guard fails the build when a new claim is written without it.
- **Never-list 13 — money a person has entered is never offered for deletion.** A late payment the office refuses is kept and routed to the cashier — it carries one non-destructive verb, "Handed to the cashier", after which the device stops counting it as money it holds. Erasing it would erase the only record that a shop paid.

---

# 6. Who may touch money

**Decided 2026-09-04:** money is recorded by the **delivery crew** at the door (cash, UPI with UTR, cheque), by the **shop itself** paying online against its own bills (a separate procedure, never a widening of the receipt endpoint), or by the **money desk** for a payment received at the office. The **salesperson never does** — no such endpoint exists on the sales service, the matrix grants none, the upload door refuses it, and the database will not insert it.

Receipts are append-only, allocated bill-to-bill oldest first unless tagged, and post a double-entry journal that must balance to the paisa at commit — enforced by a deferred constraint trigger in the database, not by service code. An issued invoice is never edited for payment state; corrections are credit notes.

**Four money rules decided during QA, each found by somebody trying to break it:**

| Rule                                                                                                                                                                                                                       | Decided    | Reference          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------ |
| **Cash still out with a crew is banked only after its trip settles.** The day-end bank register leaves out trip receipts whose trip has not settled, and the server refuses to deposit them. Cheques collected on a trip follow the same rule. | 2026-09-13 | QA DOS-132         |
| **A receipt is banked exactly once.** Banking, undoing and settling a receipt all lock it, so only one of them can win — two desks banking the same receipt at the same moment banked it twice before this.                  | 2026-09-14 | QA DOS-168 (P0)    |
| **Day-end counts every payment of the trip, however it reached the office**, net of any undone — including cash a crew took at a door with no signal, which day-end used to leave out.                                       | 2026-09-14 | QA DOS-169 (P0)    |
| **An undo takes the money from where it is now**: the van before day-end, the office till after it, the bank once banked. Undoing a trip's cash after day-end used to take it from the van's money a second time.            | 2026-09-14 | QA DOS-170         |

**A payment that arrives after its trip has settled** is refused on the phone if it is cash or a cheque, and the driver is told to hand the money to the cashier, who records it at the office; a **UPI payment is accepted**, because that money is already in the account (founder's answer, 2026-09-14). The driver's phone cannot check the vehicle in while it still holds unsent payments — and the refused payment is kept, never offered for deletion (§5.2, never-list 13).

**Money already wrong in a live database is corrected by adding, never by editing** (founder's answer, 2026-09-14). Read-only checks list every receipt banked twice, trip cash missed at a settlement or undo taken from the van after day-end; each is corrected by one appended balancing entry, approved trip by trip. When this was run on the founder's own database on 2026-09-19 it found nothing to repair — everything in it was written by the seed, not by trade.

---

# 7. Authentication and sessions

**Decided 2026-09-04: our own username + password service, no third party.** OTP over SMS or WhatsApp is a **later enhancement layered on top**, never a replacement. `auth-service` on port 3000 serves all seven apps.

| Element             | Decision                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential          | Username + password; the phone number stays a profile field                                                                                                                                                                            |
| Password policy     | 8–72 characters, at least one letter and one digit; validated wherever a password is set                                                                                                                                               |
| Storage             | argon2id hash; a dummy hash is verified on unknown usernames so timing does not reveal existence                                                                                                                                       |
| Lockout             | 5 consecutive failures lock the account for 15 minutes                                                                                                                                                                                 |
| Access token        | EdDSA JWT, 15-minute TTL, carrying user, tenant, **elected** role (§4.1), session and device; every other service verifies it against the published JWKS with no call back to auth                                                     |
| Refresh token       | Opaque, random, one **per device**, 30-day TTL, rotated on every refresh; only its SHA-256 is stored                                                                                                                                   |
| Reuse detection     | Presenting an already-rotated refresh token revokes the **whole session** and records an auth event                                                                                                                                    |
| Multi-distributor   | `switchTenant` for a shopkeeper or a staff member with more than one membership                                                                                                                                                        |
| Self-service reset  | `forgotPassword` always answers ok (an attacker must not learn which usernames exist); a hashed single-use token expires in 30 minutes and revokes every session when used. The delivery channel is the OTP layer and is not wired yet |
| Temporary passwords | An owner-set password flags `mustChangePassword`; the app forces a change                                                                                                                                                              |
| Sessions            | A user sees and revokes their own sessions only, never another's                                                                                                                                                                       |

**Unlocking a login (decided 2026-09-13, a precision on the console levels of 2026-09-12).** Only a **super** administrator unlocks, and only with a reason of 1 to 500 characters, audited as `user.enabled`. Unlocking a login that is not locked answers 200 and writes nothing. An unlock restores the user's status **and nothing else**: the sessions the lock ended stay ended, and memberships, the platform-admin disable flag and the five-failure password lock are untouched. An unlock is a door being reopened, not a history being rewritten.

**Numbered documents, including receipts (decided 2026-09-12, corrected 2026-09-13).** A receipt number is unique per distributor, series and financial year, enforced by the database. The correction matters for money: a number the **server** assigns that collides is repaired inside the same transaction — the counter moves past the highest number used, one retry, an audit row — so a lagging counter can never stop a payment being recorded. A 409 online, or a sync rejection offline, is only ever for a number a **client** supplied itself. The financial year used for numbering is IST everywhere.

**Branding at sign-in.** The sign-in response carries each membership's distributor display name and logo, so the distributor's own identity appears before any tenant-scoped call is possible. Distribution OS branding appears **only** on the welcome and sign-in screens (§8). **Decided 2026-09-21:** every app opens on a Welcome screen until a session exists on the device, and after sign-in lands for two seconds on who-you-are — the distributor's (or shop's) logo and name, the person's name, and which app this is.

**On the device.** Mobile devices are registered rows (`devices`) so a lost phone can be revoked; a revoked device's local encrypted store is wiped. The field apps' local database is encrypted from day one, with the key in the OS keychain/keystore (`docs/17` §B security), and since 2026-09-13 it belongs to **one person in one distributorship** and is deleted at sign-out (§5.2, never-list 11).

---

# 8. White-label and tenant configuration

**Decided 2026-09-04: the product is white-labelled.** Inside every app and on every printed document the distributor sees **their own** name and logo. Distribution OS branding never appears inside a distributor's documents — never-list item 10.

**Decided 2026-09-05: the product name is "Distribution OS"**, and the apps are named "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer" (store listing, icon label, welcome and sign-in screens only). **Decided 2026-09-21:** the six business apps become **one** store listing and one website, "Distribution OS", which becomes the right app after sign-in on the elected role (§4.1); the platform console stays separate, because platform staff are not the distributor's users.

Branding lives in `tenant_settings`, read by a single `tenancy.branding.get` procedure that every app calls for its chrome — including the retailer app, where the handler reads the keys as the service because a shopkeeper cannot read the settings table:

| Setting key                           | Purpose                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `branding.display_name`               | The name on every screen and document (falls back to the legal name)                         |
| `branding.logo_object_key`            | Logo object; served as a pre-signed URL valid 24 hours                                       |
| `branding.invoice_footer`             | Free text on the bill                                                                        |
| `branding.address`                    | Printed address block                                                                        |
| `seller_fssai`                        | FSSAI number on food invoices                                                                |
| `upi_vpa`                             | The distributor's own VPA behind the UPI QR on every bill                                    |
| `ewb_intra_state_threshold`           | E-way bill threshold, seeded at ₹1,00,000, changed by the owner not by code                  |
| `delivery.settlement_tolerance_paise` | Cash variance a trip may close with, seeded at ₹100                                          |
| `delivery.pod_required`               | `always` / `credit_only` / `never`, seeded at `credit_only`                                  |
| `delivery.geofence_metres`            | Distance from the shop pin that is amber evidence, seeded at 150 m — evidence, never a block |
| `dpdp.gps_retention_days`             | Raw GPS retention, seeded at 90 days                                                         |

Three settings were added by QA decisions and follow the same rule — one number per distributor, set by the owner: the **minimum shelf life to ship** (30 days unless changed; a shorter batch is passed over when another can cover the line, and a picker who still takes one gets a warning, never a block), the **expense-proof threshold** (a trip expense of ₹200 or more needs a photo of its bill; 0 means every expense), and the **office contact number** a shop sees for Call and WhatsApp (with no number set, there is no button).

Settings are read by staff (never `secret.*` keys by a non-owner) and written by the **owner alone**; so are numbering series, feature flags and the tenant's legal identity. Feature flags (`van_sales`, `brand_dms_import`, `claims_ui`, `retailer_app`, `e_invoicing`) are readable by every member because the apps gate screens on them.

What is **configurable**: settings above, feature flags, numbering series, credit modes and payment terms, schemes and price lists, settlement tolerance, proof-of-delivery policy. What is **fixed**: state machines, the seven roles, approval kinds, the role-election table (§4.1) and the permission matrix.

---

# 9. Files and document access

Nothing binary passes through a service or the database (`docs/20` rule 15). The pre-signed upload and read flow is described on the Architecture & Technology page (§9); what matters here is who may use it. Object keys are built **by the server**, never by the client, as `tenant/{tenantId}/{domain}/{entityId}/{name}.{ext}`, and every key is re-anchored to the caller's tenant on both procedures — a key from another distributor is an invalid key, never another distributor's bytes. The permission matrix gates the verb (staff may mint an upload URL, any member a read URL) and the handler then applies a per-domain table: a logo is uploaded by the owner and read by everyone; proof of delivery is uploaded by the crew and read by stock viewers plus the shop that received it; expense proofs, claim evidence and import files are back-office. Rendered documents (invoice PDF, challan, receipt) are produced by the worker, never on the request path.

**Decided 2026-09-20: there is no permanent public link to a shop's papers.** Invoices, receipts and statements keep going out as files shared from the phone. A forever-URL carrying a shop's prices and balance is refused; if a link is ever wanted it must be signed and expire in seven days.

**One exception to "nothing binary", decided 2026-09-13 and scoped tightly.** Only on the no-signal path does a doorstep delivery carry its proof photo inline through `/sync/upload`: a JPEG of at most 300 KB, the route capped at 8 MiB, and a single operation over 1 MiB recorded as a rejection rather than accepted. The server then stores the photo through the files platform as usual and the row keeps only its key. The alternative was losing the proof that the goods were handed over.

---

# 10. Audit log

`audit_log` is an append-only trail of the sensitive actions: price changes, credit-limit edits, approvals, exports, settings changes and reads of a GPS trace or the live map. Each row records actor, actor role, action, entity type and id, `before`/`after` JSON, device and time.

- **Written by whoever did the thing, in the same transaction.** The insert policy pins `actor_id` to the request's actor, so a row cannot be written in someone else's name (only the system role is exempt). Under role election (§4.1) the actor is still the **person**; the role recorded is the one they elected.
- **Read by the back office only** — the before/after of a credit-limit edit or a price change is exactly what a rep or a shopkeeper must not see (`tenancy.audit.list`).
- **Append-only.** There is no update or delete policy, and a trigger refuses both regardless.
- Indexed for the two real questions: "what happened to this shop, newest first" and "what did this person change".

Sign-in activity has its own append-only trail (`auth_events`): successes, failures with the username attempted, lockouts, refresh-token reuse, and — once role election lands — the role each sign-in acted as.

Every platform-console action against a distributor writes its own audit row, and the support-access panel shows the distributor exactly what has been read under an open window.

---

# 11. Retention

Retention runs hourly on the worker under the `BYPASSRLS` worker role, in bounded batches so a backlog never holds locks (`backend/worker/src/jobs/retention.ts`):

| Data                                  | Kept                        | Why                                                                                                  |
| ------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `idempotency_keys` (online mutations) | 24 hours                    | The only 24-hour table                                                                               |
| `sync_ops` (offline write outcomes)   | 180 days                    | A device can be offline for days and must replay to the same answer                                  |
| `trip_points` (raw GPS)               | 90 days, per-tenant setting | Privacy commitment; stop coordinates and proof of delivery stay with the invoice as business records |
| `sync_errors`, once resolved          | 90 days                     | Rejections are shown, then aged out                                                                  |
| `outbox_events`, once published       | 30 days                     | Relay bookkeeping                                                                                    |

Ledgers, invoices, journals and the audit log are **not** swept — they are the books. Backups are point-in-time recovery plus nightly dumps to an object-locked bucket held **off** the hosting provider, with a **restore drill before any real data** and monthly thereafter; stated targets are RPO 5 minutes / RTO 2 hours (`docs/11`).

---

# 12. Privacy commitments (DPDP)

India's Digital Personal Data Protection regime is treated as a design input, not a later compliance exercise (`docs/14` risk 15, `docs/17` §B):

1. **Location.** GPS is **trip-scoped**: tracking runs only while a trip is active, as a foreground service with a visible notification naming the distributor. The lawful basis for staff tracking is employment; `location_consents` records the versioned acknowledgement of the notice. Denying the OS permission never blocks a trip — the owner simply sees "location unavailable". Raw points expire in 90 days. A retailer sees an ETA, never a trace.
2. **Access to a trace is audited.** Reading a GPS trace or the live map writes an audit row.
3. **Shop-facing consent** is per distributor, not per person-in-general: the link between a person and a distributor carries the consent version, the timestamp and a separate WhatsApp opt-in.
4. **No existence leaks.** A rep onboarding a shop never queries the global identity table, so they cannot learn whether a phone already exists in another distributor's network; `forgotPassword` never reveals whether a username exists; the shop directory shows name, area, category and opt-in date only.
5. **No personal data in URLs or logs.** Structured logs carry tenant, actor, request and idempotency ids, not personal fields. No permanent public link ever carries a shop's papers (§9).
6. **Support access is not standing access.** Platform support is a time-boxed, owner-approved, audited grant — now built, with three console levels (§4), an audit row per call made under a window, and a panel that shows the distributor what was read.
7. **Residency and breach.** Hosting is India-region from day one and stays so: the decision of 2026-09-21 puts the database and the services in the **Mumbai** region, with the static app builds on a global CDN. The document-extraction engine sits behind one interface so a regional endpoint can be substituted if a brand partner requires it (residency is a design choice, not a legal mandate today). A 72-hour breach runbook sits alongside the restore, secret-rotation and device-revocation runbooks.
8. **Nothing of one person is left on a shared device for the next** (§5.2, never-list 11) — a privacy commitment as much as a security one, since the device a rep hands over at the end of a shift is the most likely place for a shop's dues to be read by the wrong person.

---

# 13. How these guarantees are proved

| Check                                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database guarantee suite (`libs/database/src/rls.test.ts`, 95 cases, up from 54) | Cost invisible to the rep and to the warehouse; tenant isolation both ways; a shop sees only its own orders, bills, credit notes, deliveries and proof; ledgers append-only and idempotent; journals must balance; audit visible to the back office only; settings hidden from the shop; the crew reads its load sheet but not the money; only the money roles may insert a receipt. An enumeration case asserts every `tenant_id` table has forced RLS and a policy |
| Permission-matrix suite                                              | Every one of the 375 procedures has a row; no orphan rows; only real roles; endpoint × role behaviour exercised against a running service, in all seven services                                                                                                                                                                                                                                                                            |
| Independent verification gate                                        | Each backend module and each app was signed off by a gate that did not write it: full build, typecheck, lint and test, then `pnpm smoke` — which signs in as each service's role and calls **every** operation of that service with the example its own OpenAPI document publishes — plus a destructive pass, a re-seed and a second smoke to prove idempotence. The counts are on Build Status & Roadmap                                  |
| QA programme (Stage 1, running)                                      | The rules on this page being driven by a person rather than a test: 153 of 158 findings from batch 2 merged, the cross-role end-to-end flow, and a **seven-day business simulation whose verdict is arithmetic** — opening stock + receipts − sales − damage − returns = closing stock per SKU per batch, and revenue = payments + outstanding. Any drift is a P0                                                                          |

Worth stating plainly, because it is the argument for the QA spend: **most of the rules added to this page in this revision were found by execution, not by review.** A credit figure reaching a shop's phone through the sync pull, a receipt banked twice by two desks at the same moment, day-end missing cash taken at a door with no signal, an offline queue that was never checked against the permission matrix — none of those were visible in the code, and all of them were visible to somebody using the product.

---

# 14. Honest gaps

- **Not built yet:** a DPDP erasure job (planned in `docs/09`, not implemented); per-tenant rate limiting at the service edge (specified in `docs/20` rule 5). The admin/platform console and its support-access grant flow, listed here as unbuilt at the last sync, **are built and gated** (2026-09-07).
- **Deployment is being built now, and it did not exist before 2026-09-21.** The container image had never been built, and there was no compose file, no TLS front, no migration step, no backup job and no secret handling. That work is a lane of its own this week (`docs/30-deploy-runbook.md`), and the go-live target is Saturday 27 September. Until it lands, the security items that only exist at deployment — secrets management with per-tenant envelope keys, the penetration checklist before the second paying tenant, and the alarm set — remain specified and unexercised.
- **The one unproven target is iOS.** Every app boots and renders on it, but the complete device pass on both platforms is scheduled work at the end of QA (founder, 2026-09-21), not something already done.
- **Field encryption at rest** is disk-level plus the encrypted mobile store; there is no column-level encryption, and none is planned for v1.
- **Five findings of QA batch 2 remain unmerged** of 158, and a closed P0 is not a finished area — the reconnect-while-signed-in path on phones is one named follow-on. `QA/STATE.md` carries the live list; nothing here is claimed as finished that is not.
