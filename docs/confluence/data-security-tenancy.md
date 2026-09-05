# Data, Security & Multi-tenancy

## Document Information

| Property     | Value                          |
| ------------ | ------------------------------ |
| Document     | Data, Security & Multi-tenancy |
| Product      | Distribution OS                |
| Version      | 2.0                            |
| Status       | Active                         |
| Owner        | Product Management             |
| Last Updated | September 2026                 |

---

# Purpose

This page is the single description of **who can reach which data, and what stops them when the application code is wrong**. It covers the tenancy model, row-level security, the seven roles and the permission matrix, what each role can never see, authentication, the audit trail, retention, the white-label settings keys, and the privacy commitments.

Every statement traces to the repository: `docs/22-source-of-truth.md` (source of truth and its dated decisions register, §7 sign-in and §9 never-list), `CLAUDE.md`, `docs/04-system-architecture-and-data-model.md` (ADRs 0001–0008), `docs/17-corrections-from-review.md` §B, `docs/20-scale-rules.md`, and the code named in each section.

**Decided 2026-09-05:** the repository is the source of truth and Confluence mirrors it. Where an older Confluence page disagrees with this one, this one wins.

As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). Everything on this page is enforced in the backend and covered by tests; **no app screen is built yet** — backend first is a deliberate sequencing decision (2026-09-04).

---

# 1. The security model in one paragraph

Security is layered, and the outer layers are allowed to fail. A role can only reach the **service** its app talks to; inside that service the **permission matrix** decides every endpoint before any business logic runs; inside the database **row-level security** decides every row, and it is enabled _and forced_, so it applies even to the connection that owns the schema. The database layer is the guarantee — the two above it exist to give a clear 403 and a readable audit trail. Anything that must never leak (purchase cost, margin, credit terms, another distributor's rows) is protected at the database layer with a test that proves it.

---

# 2. Tenancy model

**One tenant = one distributorship.** Every tenant table carries `tenant_id`; every index leads with it.

**Decided 2026-09-05: branches are not modelled in v1.** A distributorship has many warehouses, vehicles, beats and teams inside one tenant. Multi-branch is a v2 topic and the shape then is _one tenant per branch plus an owner group view_. This supersedes the older Confluence statement that "multiple branches" is an enterprise capability (`docs/24` C8).

| Data class          | Examples                                                       | Scoping                                                                   |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Tenant data         | retailers, orders, invoices, stock, ledgers, trips, settings   | `tenant_id` on every row, RLS forced                                      |
| Global curated data | manufacturers, brands, products, variants, HSN rates           | No `tenant_id`; readable by all, writable only by a curator or the system |
| Global identity     | users (one person, one login), retailer identities (one phone) | Keyed by user; memberships link a user to each tenant they work in        |

A person is global; their **membership** is per tenant and carries the role. A shopkeeper therefore has one login and can be linked to several distributors — the demo data deliberately includes **shops linked to more than one distributor** (founder requirement, 2026-09-04), and the retailer app shows one card per linked distributor.

## 2.1 How every request is scoped

All tenant data access goes through `withTenant(db, ctx, fn)`. It opens a transaction, runs `SET LOCAL ROLE app_rw` (so even the schema-owning connection is subject to RLS) and sets `app.tenant_id`, `app.actor_id` and `app.actor_role` as transaction-local settings, which every policy reads. Because all of it is `SET LOCAL`, a transaction-mode connection pooler in front of Postgres is safe (`docs/20` rule 11). The tenant context lives in `AsyncLocalStorage` for the request; asking for it outside a guarded request throws rather than defaulting. `/health` is the only unguarded route.

Three database roles: the migration owner (schema changes and seeds), `app_rw` (every service and every request — **no `BYPASSRLS`**), and `app_worker` (`BYPASSRLS`, used only by deliberately cross-tenant background jobs: outbox relay, retention sweeps, rollups).

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

---

# 4. Roles and the permission matrix

Seven membership roles exist in code: **owner, manager, accountant, salesperson, warehouse, delivery, retailer**. Two platform roles sit outside membership on the user record: **curator** (global catalog) and **support**. A third platform role, `platform_admin`, is added by module 13 with `admin-service` :3007 (decided 2026-09-05); today the enum holds `curator` and `support` only.

**Decided 2026-09-04: one app per role, one backend service per app**, so a role cannot even reach an endpoint its service does not mount — the guard answers 403 for a role the service does not serve, before any business logic. **Decided 2026-09-05:** a seventh **platform-admin** app and service (`admin-service`, port 3007) is in v1 for distributor onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access.

**The permission matrix** (`backend/libs/contracts/src/permissions.ts`) is one table: procedure path → who may call it. It carries **250 rows today, one per declared procedure**. Its properties:

- **Fails closed.** The guard refuses any path with no row, so the failure mode of a forgotten entry is "nobody can call it", never "anybody can".
- **Complete and tested.** A spec asserts every contract procedure has a row, that no row names a procedure that does not exist, and that only real roles appear; the endpoint × role behaviour is then exercised against a running service.
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

---

# 5. What each role can never see

These are the non-negotiables from `docs/22` §9. Each is a database policy with a test, not an application convention.

| Never visible to                           | What                                                                           | Enforced by                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Salesperson, warehouse, delivery, retailer | Purchase cost, landed cost, price-to-distributor, margin                       | Back-office policy on `tenant_product_costs`, supplier invoices and purchase orders                  |
| Salesperson, warehouse, delivery, retailer | The journal, the chart of accounts, write-offs                                 | `roleReadPolicy` on journal tables; back-office policy on write-offs                                 |
| Retailer                                   | Credit limit, credit mode, tier, internal shop code                            | Absent from every retailer-role contract and from the retailer write policy                          |
| Retailer                                   | Another shop's bills, orders, deliveries, proofs; any trip, cash or coordinate | Own-retailer policy narrowed to the shop's own link                                                  |
| Salesperson                                | Recording a receipt of any kind                                                | **Decided 2026-09-04:** the sales service mounts no receipt endpoint and the matrix never grants one |
| Salesperson                                | Scheme funding source, claimability and claim windows                          | Reps read schemes through a view without those columns                                               |
| Salesperson, warehouse, delivery, retailer | The audit trail (before/after of a price or credit edit)                       | `roleReadPolicy('audit_log_read', BACK_OFFICE_ROLES)`                                                |
| Any tenant                                 | Any other tenant's rows                                                        | `tenant_id` predicate in every policy, forced RLS                                                    |

Two clarifications that are often read the wrong way. First, the rule is "**the salesperson never collects**", not "never sees": a rep _does_ see a shop's outstanding on the beat screen and _does_ run the pre-order credit check — three receivables reads carry the rep, and no write does. Second, purchase price can leak through a _picture_, so supplier-invoice pages and cost-bearing documents are excluded from field-role streams and the signed-URL procedure checks the document's domain against the caller's role (§9).

---

# 6. Who may touch money

**Decided 2026-09-04:** money is recorded by the **delivery crew** at the door (cash, UPI with UTR, cheque), by the **shop itself** paying online against its own bills (a separate procedure, never a widening of the receipt endpoint), or by the **money desk** for a payment received at the office. The **salesperson never does** — no such endpoint exists on the sales service.

Receipts are append-only, allocated bill-to-bill oldest first unless tagged, and post a double-entry journal that must balance to the paisa at commit — enforced by a deferred constraint trigger in the database, not by service code. An issued invoice is never edited for payment state; corrections are credit notes.

---

# 7. Authentication and sessions

**Decided 2026-09-04: our own username + password service, no third party.** OTP over SMS or WhatsApp is a **later enhancement layered on top**, never a replacement. `auth-service` on port 3000 serves all seven apps.

| Element             | Decision                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential          | Username + password; the phone number stays a profile field                                                                                                                                                                            |
| Password policy     | 8–72 characters, at least one letter and one digit; validated wherever a password is set                                                                                                                                               |
| Storage             | argon2id hash; a dummy hash is verified on unknown usernames so timing does not reveal existence                                                                                                                                       |
| Lockout             | 5 consecutive failures lock the account for 15 minutes                                                                                                                                                                                 |
| Access token        | EdDSA JWT, 15-minute TTL, carrying user, tenant, role, session and device; every other service verifies it against the published JWKS with no call back to auth                                                                        |
| Refresh token       | Opaque, random, one **per device**, 30-day TTL, rotated on every refresh; only its SHA-256 is stored                                                                                                                                   |
| Reuse detection     | Presenting an already-rotated refresh token revokes the **whole session** and records an auth event                                                                                                                                    |
| Multi-distributor   | `switchTenant` for a shopkeeper or a staff member with more than one membership                                                                                                                                                        |
| Self-service reset  | `forgotPassword` always answers ok (an attacker must not learn which usernames exist); a hashed single-use token expires in 30 minutes and revokes every session when used. The delivery channel is the OTP layer and is not wired yet |
| Temporary passwords | An owner-set password flags `mustChangePassword`; the app forces a change                                                                                                                                                              |
| Sessions            | A user sees and revokes their own sessions only, never another's                                                                                                                                                                       |

**Branding at sign-in.** The sign-in response carries each membership's distributor display name and logo, so the distributor's own identity appears before any tenant-scoped call is possible. Distribution OS branding appears **only** on the sign-in screen (§8).

Mobile devices are registered rows (`devices`) so a lost phone can be revoked; a revoked device's local encrypted store is wiped. The field apps' local database is encrypted from day one, with the key in the OS keychain/keystore (`docs/17` §B security).

---

# 8. White-label and tenant configuration

**Decided 2026-09-04: the product is white-labelled.** Inside every app and on every printed document the distributor sees **their own** name and logo. Distribution OS branding never appears inside a distributor's documents — never-list item 10.

**Decided 2026-09-05: the product name is "Distribution OS"**, and the apps are named "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer" (store listing, icon label, sign-in screen only).

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

Settings are read by staff (never `secret.*` keys by a non-owner) and written by the **owner alone**; so are numbering series, feature flags and the tenant's legal identity. Feature flags (`van_sales`, `brand_dms_import`, `claims_ui`, `retailer_app`, `e_invoicing`) are readable by every member because the apps gate screens on them.

What is **configurable**: settings above, feature flags, numbering series, credit modes and payment terms, schemes and price lists, settlement tolerance, proof-of-delivery policy. What is **fixed**: state machines, the seven roles, approval kinds and the permission matrix.

---

# 9. Files and document access

Nothing binary passes through a service or the database (`docs/20` rule 15). The pre-signed upload and read flow is described on the Architecture & Technology page (§9); what matters here is who may use it. Object keys are built **by the server**, never by the client, as `tenant/{tenantId}/{domain}/{entityId}/{name}.{ext}`, and every key is re-anchored to the caller's tenant on both procedures — a key from another distributor is an invalid key, never another distributor's bytes. The permission matrix gates the verb (staff may mint an upload URL, any member a read URL) and the handler then applies a per-domain table: a logo is uploaded by the owner and read by everyone; proof of delivery is uploaded by the crew and read by stock viewers plus the shop that received it; expense proofs, claim evidence and import files are back-office. Rendered documents (invoice PDF, challan, receipt) are produced by the worker, never on the request path.

---

# 10. Audit log

`audit_log` is an append-only trail of the sensitive actions: price changes, credit-limit edits, approvals, exports, settings changes and reads of a GPS trace or the live map. Each row records actor, actor role, action, entity type and id, `before`/`after` JSON, device and time.

- **Written by whoever did the thing, in the same transaction.** The insert policy pins `actor_id` to the request's actor, so a row cannot be written in someone else's name (only the system role is exempt).
- **Read by the back office only** — the before/after of a credit-limit edit or a price change is exactly what a rep or a shopkeeper must not see (`tenancy.audit.list`).
- **Append-only.** There is no update or delete policy, and a trigger refuses both regardless.
- Indexed for the two real questions: "what happened to this shop, newest first" and "what did this person change".

Sign-in activity has its own append-only trail (`auth_events`): successes, failures with the username attempted, lockouts and refresh-token reuse.

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

Ledgers, invoices, journals and the audit log are **not** swept — they are the books. Backups are point-in-time recovery plus nightly dumps to an object-locked bucket, with a **restore drill before any real data** and monthly thereafter; stated targets are RPO 5 minutes / RTO 2 hours (`docs/11`).

---

# 12. Privacy commitments (DPDP)

India's Digital Personal Data Protection regime is treated as a design input, not a later compliance exercise (`docs/14` risk 15, `docs/17` §B):

1. **Location.** GPS is **trip-scoped**: tracking runs only while a trip is active, as a foreground service with a visible notification naming the distributor. The lawful basis for staff tracking is employment; `location_consents` records the versioned acknowledgement of the notice. Denying the OS permission never blocks a trip — the owner simply sees "location unavailable". Raw points expire in 90 days. A retailer sees an ETA, never a trace.
2. **Access to a trace is audited.** Reading a GPS trace or the live map writes an audit row.
3. **Shop-facing consent** is per distributor, not per person-in-general: the link between a person and a distributor carries the consent version, the timestamp and a separate WhatsApp opt-in.
4. **No existence leaks.** A rep onboarding a shop never queries the global identity table, so they cannot learn whether a phone already exists in another distributor's network; `forgotPassword` never reveals whether a username exists; the shop directory shows name, area, category and opt-in date only.
5. **No personal data in URLs or logs.** Structured logs carry tenant, actor, request and idempotency ids, not personal fields.
6. **Support access is not standing access.** Platform support is a time-boxed, owner-approved, audited grant — the mechanism the v1 admin console (§4) makes visible and revocable.
7. **Residency and breach.** Hosting is India-region from day one, and the document-extraction engine sits behind one interface so a regional endpoint can be substituted if a brand partner requires it (residency is a design choice, not a legal mandate today). A 72-hour breach runbook sits alongside the restore, secret-rotation and device-revocation runbooks.

---

# 13. How these guarantees are proved

| Check                                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database guarantee suite (`libs/database/src/rls.test.ts`, 54 cases) | Cost invisible to the rep and to the warehouse; tenant isolation both ways; a shop sees only its own orders, bills, credit notes, deliveries and proof; ledgers append-only and idempotent; journals must balance; audit visible to the back office only; settings hidden from the shop; the crew reads its load sheet but not the money. An enumeration case asserts every `tenant_id` table has forced RLS and a policy                  |
| Permission-matrix suite                                              | Every procedure has a row; no orphan rows; only real roles; endpoint × role behaviour                                                                                                                                                                                                                                                                                                                                                      |
| Independent verification gate                                        | Each module is signed off by a gate that did not write it: full build, typecheck, lint and test twice, then `pnpm smoke` — which signs in as each service's role and calls **every** operation of that service with the example its own OpenAPI document publishes — plus a destructive pass, a re-seed and a second smoke to prove idempotence, generated-README and format checks. The counts it produced are on Build Status & Roadmap. |

---

# 14. Honest gaps

- **Not built yet:** the admin/platform console and its support-access grant flow (module 13, decided 2026-09-05); a DPDP erasure job (planned in `docs/09`, not implemented); per-tenant rate limiting at the service edge (specified in `docs/20` rule 5).
- **Deployment-stage items:** secrets management with per-tenant envelope keys, penetration checklist before the second paying tenant, and the alarm set — all specified, none exercised, because the product runs on a local database today by decision (2026-09-04).
- **Field encryption at rest** is disk-level plus the encrypted mobile store; there is no column-level encryption, and none is planned for v1.
