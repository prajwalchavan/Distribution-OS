# Distribution OS — Integrations & Data Migration

## Document Information

| Property     | Value                         |
| ------------ | ----------------------------- |
| Document     | Integrations & Data Migration |
| Product      | Distribution OS               |
| Version      | 2.0                           |
| Status       | Active                        |
| Owner        | Prajwal Chavan                |
| Last Updated | September 2026                |

**New page, September 2026.** The v1.0 space listed "Extensibility for future integrations" as a principle but never said which systems Distribution OS talks to, how a distributor's twenty years of data gets in, or what happens to a brand that forces its own software on the distributor. This page answers all three. Source documents: `docs/22-source-of-truth.md` (single source of truth), `docs/17-corrections-from-review.md` §D7, `docs/10-integrations.md`, `docs/plans/integrations.md`, `backend/libs/contracts/src/integrations.ts` and `permissions.ts`, `docs/23-app-screens-and-api-gaps.md`, ADR 0014. Where this page and the repository disagree, the repository wins.

---

# 1. The rule that shapes every integration

**The integration bus is files, not APIs.**

No brand DMS, and none of the billing packages Indian distributors actually run, exposes a distributor-facing API worth building against (`docs/10`, ADR 0014). So Distribution OS does not call a manufacturer's server, a brand's server or a GST Suvidha Provider. Every row that enters through this module started as a file a human downloaded from that system's own report screen and uploaded here; every file that leaves is a download the operator hands to their CA or pastes into a government portal.

Three consequences the product lives with:

1. **Nothing is real-time across a system boundary.** Imports and exports are jobs with a status, not synchronous calls.
2. **Nothing binary passes through a service.** An upload is a pre-signed PUT; a download is a pre-signed GET (`files.uploadUrl`, `integrations.exports.downloadUrl`).
3. **A human always confirms before anything becomes real.** Matching is best-effort; a row the matcher is not sure about waits for a person.

---

# 2. Scope at a glance

| Integration                                       | What it does                                                                                          | v1 status                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Brand-DMS coexistence (FieldAssist / Too Yumm)    | Import the brand's own secondary invoices; never issue a second legal invoice                         | Decided, specified; contract landed, module queued            |
| Generic mapped importer                           | Upload → preview → map → save profile → dry run → review → commit → confirm (or roll back)            | Decided, specified; contract landed, module queued            |
| Saved source profiles                             | TradeEzee, Marg, Busy, Tally, FieldAssist, Excel, Other — ship as data, refined without a code change | Decided, specified                                            |
| Tally XML export                                  | Sales, receipt and purchase vouchers with stable GUIDs; ledger mapping screen                         | Decided, specified                                            |
| WhatsApp                                          | Outbound templates (order, invoice, delivery, dues) and inbound free-text capture                     | Decided; notifications module queued                          |
| WhatsApp / voice order capture into a draft order | Free text or speech parsed against the shop's own history, **always human-confirmed**                 | **Decided 2026-09-05: in v1**                                 |
| GST e-invoice (IRN) and e-way bill                | Recipient-side QR verification; outbound fields recorded and exported as JSON stubs                   | Partial by design — no GSP call in v1                         |
| Maps and route sequencing                         | Navigation hand-off to the phone's map app; stop sequencing by distance and time windows              | **Decided 2026-09-05: sequencing in v1**, driver may override |
| Tally Connector (live polling of TallyPrime)      | Windows agent that pushes vouchers while Tally is open                                                | Post-pilot, not v1                                            |
| ONDC                                              | Vocabulary alignment only (payment terms, case size, serviceable pincodes, category mapping)          | Not an integration we build in v1                             |

**Decided 2026-09-05:** route sequencing, WhatsApp order parsing, voice capture and demand forecasting are **all in v1**, in a dedicated AI module. This supersedes the earlier "must not build" line on route optimisation and the earlier post-pilot deferral of WhatsApp and voice parsing (`docs/22` §8; the v1.0 space's Goal 10 "AI-Ready Platform" is therefore now a v1 commitment, not a future one).

---

# 3. Brand-DMS coexistence

Some brands bill through their own DMS and the distributor has no choice. The pilot customer's Too Yumm business is billed in **FieldAssist**; Campa and MOM are billed in the distributor's own system. This is not an edge case — it is the normal condition of an Indian FMCG distributor, and the v1.0 space did not describe it at all.

**The rule (ADR 0014, non-negotiable #5 in `docs/22` §9): a brand-DMS sale is never re-invoiced.** The brand already issued the legal document. Distribution OS stores that document under **its own number**, posts the receivable so the distributor's outstanding is complete, and **moves no stock through the sale path** — because the brand's field force delivered it.

How it works:

1. The operator downloads the brand's invoice export (or captures the bills at day-end) and uploads it.
2. Rows sharing one invoice number become **one** invoice record with `source = brand_dms_import`, carrying the brand's invoice number in an external numbering series.
3. The shop is matched by the party code the brand uses, remembered from then on, so next month's file matches itself.
4. An invoice number already on file is **skipped, never a job failure** — monthly exports overlap, and a bulk import must tolerate that the way the offline sync endpoint tolerates a replay.
5. Tally export excludes those lines **per line, not per invoice** (see §5), because the CA already keys them from the brand's own DMS.

The day-end **photograph** path for brand-DMS bills is captured and reviewed by the document-intelligence module but deliberately refuses to commit today; the bulk file path above is the only committed entry point in this cut (`docs/plans/docint.md` §8.3). That is a sequencing choice, not a gap in the decision.

---

# 4. Data migration: one importer, not one reader per vendor

**Decided 2026-09-04 (`docs/17` §D7, founder):** data migration is its own work item and it is **broader than any one vendor**. A distributor arriving on Distribution OS may come from TradeEzee, Marg, Busy, Tally, a brand DMS, a pile of Excel sheets — or from no software at all. So the product builds a **generic mapped importer first**, and treats every named vendor as a saved mapping rather than as code. **No vendor's column names are hard-coded anywhere.**

## 4.1 The wizard

One wizard, any CSV or XLSX, five targets:

1. **Upload** — the file is PUT through a signed URL; the job is registered and a worker parses it, writing one row per source row with the cells keyed by header. Job status: `staged`.
2. **Preview** — the first rows with the detected columns and a suggested field per column, taken from the built-in profile for that source plus header heuristics.
3. **Map** — file column → target field, by hand. Fixed values for fields the file lacks (for example place of supply), the date format, and whether amounts are rupees or paise.
4. **Save profile** — the mapping is saved as a named profile per source and target, so next month's file maps itself.
5. **Dry run** — every row validated against the target's rules, parties and items matched, and the diff answered: how many rows would be created, updated, skipped, need a human, or are wrong. **Creates nothing.** Large files are scored by the worker and polled.
6. **Review** — the operator resolves the rows the matcher could not: pin a shop or a product, correct a value, or skip a junk row. A pinned party code is remembered so it auto-matches next time.
7. **Commit** — applied **one row per transaction**, so one bad row out of five thousand never rolls back the other 4,999. Row-level errors are short English sentences naming the row and the column, never a raw exception.
8. **Confirm** — the sign-off. Until confirm, the run is **reversible**.

Job lifecycle: `queued → staged → running → committed → confirmed | rolled_back`; `failed` if the file will not parse or the worker crashes; `cancelled` from `queued` or `staged`.

## 4.2 The five targets

| Target                   | What a committed row becomes                                                                                                           | Ledger effect                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Party master             | A shop record (name, phone, GSTIN, address, beat, Tally ledger name)                                                                   | None                         |
| Item master              | A listing of an existing catalogue product for this distributor (local alias, case size)                                               | None                         |
| Opening outstanding      | **One bill, never a lump sum**: an opening invoice plus its receivable, posted as a balanced journal entry against the OPENING account | Yes — balanced, bill-to-bill |
| Sales register (history) | The shop's buying history, used by the reorder-suggestion engine                                                                       | None                         |
| Brand-DMS invoices       | One invoice under the brand's own number (see §3)                                                                                      | Receivable only; no stock    |

## 4.3 What an import never does

- **Never sets a credit limit, credit days, tier or credit mode.** Those stay a deliberate, one-shop-at-a-time decision with its own approval trail.
- **Never creates a new global product.** A bulk file lacks the structured fields the catalogue requires; an unmatched item waits for a human.
- **Never commits a guess.** A row below the match confidence floor, or with two close candidates, is `needs_review`; commit refuses it unless the operator explicitly leaves it out.
- **Never lumps opening balances together.** Per bill, so ageing buckets and bill-to-bill allocation work from day one.

## 4.4 Reversibility and the owner sign-off

**Decided 2026-09-04:** "a migration run must be reversible before it is confirmed." Rollback before confirm cancels the invoices the run created and **reverses** their journal entries with a reversal entry — the books are append-only, so nothing is ever deleted. It refuses (with a clear error) if money has since been allocated against one of those bills. Shops and listings the run created are deactivated; ones it updated are restored from the snapshot each row keeps. Rows keep their status and identifiers for the audit trail.

**Opening balances carry an extra lock:** commit and confirm of that target refuse every role except the **owner**. Money entering the books with no sale behind it is the one thing in this module that no manager may wave through.

## 4.5 Where migration sits in onboarding

**Decided 2026-09-05:** a **platform console** (a seventh app, "Distribution OS - Admin") is in v1 and owns distributor onboarding, plans and subscription state. Migration is not part of it: the console creates the tenant, and the migration then runs **inside that distributor's own tenant**, by their own owner or manager, in the owner or manager app. **Decided 2026-09-05:** one tenant = one distributorship, so a migration never spans two businesses.

---

# 5. Tally export

The distributor's CA keeps the books in Tally. Distribution OS does not replace that — it feeds it.

- **What is exported:** sales vouchers (invoices, plus the window's credit notes as Tally credit notes so the sales register matches to the paisa), receipt vouchers and purchase vouchers, for a date range the operator picks (capped at 366 days).
- **Ledger mapping screen:** party → ledger, sales ledgers, stock items, godowns, units and voucher types. Names come from the record's own Tally ledger name first, and the mapping table second.
- **Never double-posts:** every voucher carries a stable GUID plus a content hash, so re-exporting an overlapping window makes Tally **update** rather than duplicate. An "already exported" badge shows on the registers.
- **Brand-DMS lines are excluded per line, not per invoice.** A mixed-brand invoice exports a voucher for the eligible lines only; an invoice with no eligible line emits no voucher at all.
- **Decided 2026-09-04 (white-label):** the company name in the file is the **distributor's own** legal name — or the name their CA's Tally company uses — never "Distribution OS". Non-negotiable #10.
- **Acceptance test:** the CA imports a week of vouchers into a restored backup and the Tally sales register matches ours **to the paisa**.

Other export kinds on the same queue: GSTR-1 JSON, sales register (XLSX), outstanding (XLSX), e-way bill JSON, e-invoice JSON — plus claim sheets and reports queued by their own modules. The exports screen is one history, whoever queued the row.

A Windows **Tally Connector** that polls a live TallyPrime instance is post-pilot, explicitly not v1.

---

# 6. WhatsApp

- **Outbound:** pre-approved utility templates for order confirmed, invoice issued, out for delivery, payment received and dues reminders, sent through Meta's Cloud API directly. Every message is a durable record with its own status, retry state and cost, dispatched by a worker and never inline in a request. A shop that has not opted into WhatsApp gets an SMS instead — **never a silent drop**.
- **Inbound (v1, decided 2026-09-05):** a shop's free-text message ("2 case campa 1L kal") is captured and parsed into a **draft order** against that shop's own purchase history. It is **always confirmed by a human** before it becomes an order. Voice capture runs through the same parser.
- **Cost is a back-office figure:** per-message cost and provider identifiers are visible to owner, manager and accountant only — the same posture as purchase cost.
- **Decided 2026-09-04:** sign-in is our own **username + password** token service. OTP over WhatsApp or SMS is a later enhancement layered on top; the earlier plan to use a third-party auth provider's send hook is superseded.

---

# 7. GST: e-invoice and e-way bill

Deliberately partial in v1, and honest about it.

| Direction                | v1 behaviour                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound (supplier bills) | The QR on a supplier's e-invoice is verified **offline** — signature, IRN hash, GSTINs and totals — as the first validator in the stock-in pipeline. No government call needed.                                                                       |
| Outbound (our invoices)  | The invoice model is IRN-ready: numbers within 16 characters, HSN, place of supply, e-way bill fields. IRN generation is a **local stub behind a feature flag** — no GSP is called. E-way bill numbers are entered by hand until a GSP is contracted. |
| Export                   | `einvoice_json` and `eway_bill_json` bundle whatever has been recorded into the government's JSON shape for a human to hand to a GSP tool or the portal.                                                                                              |

Rationale: e-invoicing is mandatory only above a turnover threshold the pilot customer is below, and a GSP contract is a commercial dependency, not an engineering one. Building the fields now and the call later costs nothing; building the call now blocks the pilot.

---

# 8. Maps and routing

- **Navigation** hands off to the phone's own map application from the delivery app's stop screen — free on both platforms, and the driver's familiar app.
- **Stop sequencing (decided 2026-09-05, in v1):** stops are ordered by distance and time windows, and the **driver may override** the suggested order. This supersedes the earlier decision to ship manual sequencing only.
- **Geofencing is evidence, never a block.** A check-in or delivery outside the expected radius is flagged amber for the owner; a missing GPS fix never stops a delivery or an order.
- Map providers sit behind one internal interface so a provider change is a configuration change, not a rewrite.

---

# 9. Who may do what

| Action                                                         | Owner         | Manager | Accountant | Field roles |
| -------------------------------------------------------------- | ------------- | ------- | ---------- | ----------- |
| Run an import (create, map, dry run, review, commit, rollback) | Yes           | Yes     | **No**     | No          |
| Read imports, rows and profiles                                | Yes           | Yes     | Yes        | No          |
| Commit or confirm **opening balances**                         | **Yes, only** | No      | No         | No          |
| Request and download exports                                   | Yes           | Yes     | Yes        | No          |
| Maintain the Tally ledger mapping                              | Yes           | Yes     | Yes        | No          |

**Decided 2026-09-05:** the accountant is the **money desk plus reads** — they read every import and take every export and keep the Tally mapping, but they never run an import write. A bulk file creates shops and catalogue listings, which the accountant may not edit one row at a time either; the bulk path is not a way around that.

Sales, warehouse, delivery and retailer roles never touch this module. That is enforced twice: the services those apps talk to do not mount it, and the database's row-level security returns **zero rows** for those roles even if a route were mounted by mistake.

Screens that use it (`docs/23`): owner **Imports wizard** and **Exports & Tally**; manager/accountant **Brand-DMS bills** and **Tally export & mapping**.

---

# 10. Build status

As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). **No app screen exists yet** — backend first is a deliberate sequencing decision (2026-09-04).

| Piece                                                                                                                                       | Status                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Six database tables (import jobs, rows, profiles, export jobs, Tally mappings, Tally sync ledger), with back-office-only row-level security | Built                                                    |
| The API contract — **21 procedures** across imports, profiles, exports and Tally — and its permission rows                                  | Built                                                    |
| Signed upload and download URLs the wizard needs                                                                                            | Built                                                    |
| The module itself: staging, matching, dry run, commit, rollback, renderers, worker jobs, demo data                                          | **Queued — module 6 of 10** in the current backend chain |
| WhatsApp and SMS adapters, templates, inbound capture                                                                                       | Queued — notifications module (8 of 10)                  |
| WhatsApp/voice order parsing, forecasting, route sequencing                                                                                 | Queued — AI module, added to scope 2026-09-05            |
| Import and export **screens** in the owner and manager apps                                                                                 | After the backend, layout **A Ledger**                   |

Integrations was deliberately moved earlier in the build order (from ninth to sixth) because the claims and reporting modules both need its export queue and would otherwise each build their own.

---

# 11. Open decisions and honest gaps

1. **Invoice series at cut-over** from the pilot customer's current ERP — continue the old numbers or start fresh? Configurable either way; **an answer is needed before go-live** (`docs/22` §10).
2. **No real sample export exists yet** from TradeEzee or FieldAssist. Column layouts in the built-in profiles are assumed from the report names. This blocks nothing — the importer is written against the generic path and tested with fixtures — and the profiles are refined the moment a real file arrives, **without a code change**.
3. **Does the CA already key the brand's invoices into Tally?** Assumed **yes**, so the Tally export excludes those lines by default. If the answer is no, one setting per brand changes it.
4. **Mixed-brand vouchers** export as a partial-amount voucher rather than being excluded whole. A real assumption, flagged rather than silently made.
5. **Product code memory across imports.** Shop codes are remembered; product matches are re-scored each time except on an exact barcode hit. If a monthly file keeps asking the operator to resolve the same items, a product-code table is the fix — deferred until that pain is real.
6. **Tally masters import** (as opposed to export) and brand-DMS **order** files are out of this cut: Tally is export-only, FieldAssist is invoices only.

---

# 12. Sources

`docs/22-source-of-truth.md` §5, §8, §9 · `docs/17-corrections-from-review.md` §D rows 1, 6, 7 · `docs/10-integrations.md` · `docs/plans/integrations.md` · `docs/plans/notifications.md` · `docs/plans/docint.md` §8.3 · `docs/plans/billing.md` · `docs/23-app-screens-and-api-gaps.md` (O21, O22, M11, M13) · `docs/18-build-log.md` · ADR 0014 (brand-DMS coexistence) · `backend/libs/contracts/src/integrations.ts` and `permissions.ts` · `docs/24-confluence-alignment.md` §6 proposals 5, 6 and 11.
