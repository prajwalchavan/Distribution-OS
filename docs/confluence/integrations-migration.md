# Distribution OS — Integrations & Data Migration

## Document Information

| Property     | Value                         |
| ------------ | ----------------------------- |
| Document     | Integrations & Data Migration |
| Product      | Distribution OS               |
| Version      | 2.2                           |
| Status       | Active                        |
| Owner        | Prajwal Chavan                |
| Last Updated | 29 September 2026             |

This page says which systems Distribution OS talks to, how a distributor's twenty years of data gets in, and how the product works beside a brand that forces its own software on the distributor.

---

# 1. The rule that shapes every integration

**The integration bus is files, not APIs.**

No brand DMS, and none of the billing packages Indian distributors actually run, exposes a distributor-facing API worth building against. So Distribution OS does not call a manufacturer's server, a brand's server or a GST Suvidha Provider. Every row that enters through this module started as a file a human downloaded from that system's own report screen and uploaded here; every file that leaves is a download the operator hands to their CA or pastes into a government portal.

Three consequences the product lives with:

1. **Nothing is real-time across a system boundary.** Imports and exports are jobs with a status, not synchronous calls.
2. **Nothing binary passes through a service.** An upload is a pre-signed PUT; a download is a pre-signed GET (`files.uploadUrl`, `integrations.exports.downloadUrl`).
3. **A human always confirms before anything becomes real.** Matching is best-effort; a row the matcher is not sure about waits for a person.

---

# 2. Scope at a glance

| Integration                                       | What it does                                                                                          | In version 1                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Brand-DMS coexistence (FieldAssist / Too Yumm)    | Import the brand's own secondary invoices; never issue a second legal invoice                         | **Yes**                                          |
| Generic mapped importer                           | Upload → preview → map → save profile → dry run → review → commit → confirm (or roll back)            | **Yes**                                          |
| Saved source profiles                             | TradeEzee, Marg, Busy, Tally, FieldAssist, Excel, Other — ship as data, refined without a code change | **Yes**                                          |
| Tally XML export                                  | Sales, receipt and purchase vouchers with stable GUIDs; ledger mapping screen                         | **Yes**                                          |
| WhatsApp                                          | Outbound templates (order, invoice, delivery, dues) and inbound free-text capture                     | **Yes** — the notifications module               |
| WhatsApp / voice order capture into a draft order | Free text or speech parsed against the shop's own history, **always human-confirmed**                 | **Yes**                                          |
| GST e-invoice (IRN) and e-way bill                | Recipient-side QR verification; outbound fields recorded and exported as JSON stubs                   | Partial by design — no GSP call in version 1     |
| Maps and route sequencing                         | Navigation hand-off to the phone's map app; stop sequencing by distance and time windows              | **Yes**; the driver may override                 |
| Tally Connector (live polling of TallyPrime)      | Windows agent that pushes vouchers while Tally is open                                                | Comes after version 1                            |
| ONDC                                              | Vocabulary alignment only (payment terms, case size, serviceable pincodes, category mapping)          | Not an integration in version 1; vocabulary only |

Route sequencing, WhatsApp order parsing, voice capture and demand forecasting are **all in version 1**, in a dedicated AI module.

---

# 3. Brand-DMS coexistence

Some brands bill through their own DMS and the distributor has no choice. For example, a distributor's Too Yumm business is billed in **FieldAssist** while Campa and MOM are billed in the distributor's own system. This is not an edge case — it is the normal condition of an Indian FMCG distributor.

**The rule: a brand-DMS sale is never re-invoiced.** The brand already issued the legal document. Distribution OS stores that document under **its own number**, posts the receivable so the distributor's outstanding is complete, and **moves no stock through the sale path** — because the brand's field force delivered it.

How it works:

1. The operator downloads the brand's invoice export (or captures the bills at day-end) and uploads it.
2. Rows sharing one invoice number become **one** invoice record with `source = brand_dms_import`, carrying the brand's invoice number in an external numbering series.
3. The shop is matched by the party code the brand uses, remembered from then on, so next month's file matches itself.
4. An invoice number already on file is **skipped, never a job failure** — monthly exports overlap, and a bulk import must tolerate that the way the offline sync endpoint tolerates a replay.
5. Tally export excludes those lines **per line, not per invoice** (see §5), because the CA already keys them from the brand's own DMS.

The day-end **photograph** path for brand-DMS bills is captured and reviewed by the document-intelligence module, but committing from a photograph is not available yet; the bulk file path above is the only way a brand-DMS invoice is committed. From a brand DMS, invoice files are imported; order files are not.

---

# 4. Data migration: one importer, not one reader per vendor

Data migration is **broader than any one vendor**. A distributor arriving on Distribution OS may come from TradeEzee, Marg, Busy, Tally, a brand DMS, a pile of Excel sheets — or from no software at all. So the product has a **generic mapped importer**, and treats every named vendor as a saved mapping rather than as code. **No vendor's column names are hard-coded anywhere.**

## 4.1 The wizard

One wizard, any CSV or XLSX, five targets:

1. **Upload** — the file is PUT through a signed URL; the job is registered and a worker parses it, writing one row per source row with the cells keyed by header. Job status: `staged`.
2. **Preview** — the first rows with the detected columns and a suggested field per column, taken from the built-in profile for that source plus header heuristics.
3. **Map** — file column → target field, by hand. Fixed values for fields the file lacks (for example place of supply), the date format, and whether amounts are rupees or paise.
4. **Save profile** — the mapping is saved as a named profile per source and target, so next month's file maps itself.
5. **Dry run** — every row validated against the target's rules, parties and items matched, and the diff answered: how many rows would be created, updated, skipped, need a human, or are wrong. **Creates nothing.** Large files are scored by the worker and polled.
6. **Review** — the operator resolves the rows the matcher could not: pin a shop or a product, correct a value, or skip a junk row. A pinned party code is remembered so it auto-matches next time; product matches are scored again on every file, except on an exact barcode hit.
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

A migration run is **reversible until it is confirmed**. Rollback before confirm cancels the invoices the run created and **reverses** their journal entries with a reversal entry — the books are append-only, so nothing is ever deleted. It refuses (with a clear error) if money has since been allocated against one of those bills. Shops and listings the run created are deactivated; ones it updated are restored from the snapshot each row keeps. Rows keep their status and identifiers for the audit trail.

**Opening balances carry an extra lock:** commit and confirm of that target refuse every role except the **owner**. Money entering the books with no sale behind it is the one thing in this module that no manager may wave through.

## 4.5 Where migration sits in onboarding

The **platform console** (a separate app, "Distribution OS - Admin") owns distributor onboarding, plans and subscription state. Migration is not part of it: the console creates the tenant, and the migration then runs **inside that distributor's own tenant**, by their own owner or manager, on their own screens. One tenant is one distributorship, so a migration never spans two businesses.

At cut-over from a previous system, the invoice series can continue the old numbers or start fresh; either is configurable.

---

# 5. Tally export

The distributor's CA keeps the books in Tally. Distribution OS does not replace that — it feeds it.

- **What is exported:** sales vouchers (invoices, plus the window's credit notes as Tally credit notes so the sales register matches to the paisa), receipt vouchers and purchase vouchers, for a date range the operator picks (capped at 366 days).
- **Ledger mapping screen:** party → ledger, sales ledgers, stock items, godowns, units and voucher types. Names come from the record's own Tally ledger name first, and the mapping table second.
- **Never double-posts:** every voucher carries a stable GUID plus a content hash, so re-exporting an overlapping window makes Tally **update** rather than duplicate. An "already exported" badge shows on the registers.
- **Brand-DMS lines are excluded per line, not per invoice.** A mixed-brand invoice exports a voucher for the eligible lines only, as a partial-amount voucher; an invoice with no eligible line emits no voucher at all. Exclusion is the default because the CA already keys the brand's invoices into Tally; one setting per brand changes it.
- **White-label:** the company name in the file is the **distributor's own** legal name — or the name their CA's Tally company uses — never "Distribution OS".
- **Export only:** Tally masters are not imported; the Tally connection runs one way, out of Distribution OS.
- **Acceptance test:** the CA imports a week of vouchers into a restored backup and the Tally sales register matches the product's **to the paisa**.

Other export kinds on the same queue: GSTR-1 JSON, sales register (XLSX), outstanding (XLSX), e-way bill JSON, e-invoice JSON — plus claim sheets and reports queued by their own modules. The exports screen is one history, whoever queued the row.

A Windows **Tally Connector** that polls a live TallyPrime instance comes after version 1.

---

# 6. WhatsApp

- **Outbound:** pre-approved utility templates for order confirmed, invoice issued, out for delivery, payment received and dues reminders, sent through Meta's Cloud API directly. Every message is a durable record with its own status, retry state and cost, dispatched by a worker and never inline in a request. A shop that has not opted into WhatsApp gets an SMS instead — **never a silent drop**.
- **Inbound:** a shop's free-text message ("2 case campa 1L kal") is captured and parsed into a **draft order** against that shop's own purchase history. It is **always confirmed by a human** before it becomes an order. Voice capture runs through the same parser.
- **Cost is a back-office figure:** per-message cost and provider identifiers are visible to owner, manager and accountant only — the same posture as purchase cost.
- **Sign-in** is a **username and a password**, on the product's own token service. OTP over WhatsApp or SMS comes after version 1, layered on top of the password rather than replacing it.

---

# 7. GST: e-invoice and e-way bill

Deliberately partial in version 1.

| Direction                | Version 1 behaviour                                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound (supplier bills) | The QR on a supplier's e-invoice is verified **offline** — signature, IRN hash, GSTINs and totals — as the first validator in the stock-in pipeline. No government call needed.                                             |
| Outbound (our invoices)  | The invoice model is IRN-ready: numbers within 16 characters, HSN, place of supply, e-way bill fields. IRN generation is a **local stub behind a feature flag** — no GSP is called. E-way bill numbers are entered by hand. |
| Export                   | `einvoice_json` and `eway_bill_json` bundle whatever has been recorded into the government's JSON shape for a human to hand to a GSP tool or the portal.                                                                    |

Why: e-invoicing is mandatory only above a turnover threshold, and a GSP contract is a commercial dependency, not an engineering one. The invoice carries the fields already; the call to a GSP is not available yet.

---

# 8. Maps and routing

- **Navigation** hands off to the phone's own map application from the delivery app's stop screen — free on both platforms, and the driver's familiar app.
- **Stop sequencing:** stops are ordered by distance and time windows, and the **driver may override** the suggested order.
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

The accountant is the **money desk plus reads** — they read every import and take every export and keep the Tally mapping, but they never run an import write. A bulk file creates shops and catalogue listings, which the accountant may not edit one row at a time either; the bulk path is not a way around that.

Sales, warehouse, delivery and retailer roles never touch this module. That is enforced twice: the services those roles talk to do not mount it, and the database's row-level security returns **zero rows** for those roles even if a route were mounted by mistake. The module's six tables — import jobs, rows, profiles, export jobs, Tally mappings and the Tally sync ledger — all carry back-office-only row-level security.

Screens that use it: owner **Imports wizard** and **Exports & Tally**; manager/accountant **Brand-DMS bills** and **Tally export & mapping**.
