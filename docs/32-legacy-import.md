# 32 · Loading the old software's data (TradeEzee → Distribution OS)

**Status.** Built and tested on branch `legacy-import` (not merged, not pushed). Nothing in this document is about a
real customer: it holds counts, column mappings and rules. The founder's files stay where they are, read-only, and are
never copied, embedded or echoed by the importer (`backend/tools/legacy/report.test.ts` fails the build if a name, phone
number, GSTIN, bill number or item code ever reaches the report).

**What it is.** `backend/tools/import-legacy-extracts.mts` plus a parsing library and its specs in
`backend/tools/legacy/` (the `@dos/tools` workspace package). It reads the legacy extracts by path, builds a **plan**
(what would be written, from the files alone — no database), prints a report, and with `--commit` writes the plan into a
distributor's database **through the application's own services**. It changes no product behaviour, no schema and no
contract.

```bash
cd backend
pnpm import:legacy --dir "<folder with the extracts>"                       # dry run: plan + report, writes nothing
pnpm import:legacy --dir "<folder>" --tenant tarsun --commit                # load (DATABASE_URL, migrated + bootstrapped DB)
pnpm import:legacy --dir "<folder>" --tenant tarsun --commit --opening-stock
pnpm import:legacy --dir "<folder>" --tenant tarsun --commit --outstanding-from-backup --as-of 2026-10-01
pnpm import:legacy --help                                                    # every flag
```

The customer PDF is read by `legacy/pdf-to-text.py` (pypdf, layout mode) because Node has no PDF text reader in this
repository; set `LEGACY_PYTHON` to an interpreter that has `pypdf` if `python3` lacks it.

---

## 1. What each file gave

| File                          | What it is                                                                                      | Rows                                       | Used for                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `CompanywiseProductList.xlsx` | Item master, one row per SKU                                                                    | 84                                         | Manufacturers, products, variants, HSN rates, listings, price list                         |
| `customer data whole pdf.pdf` | Crystal report "AccountWise ListWithAll Details2", 91 pages, printed 18 Sep 2026                | 677 customers                              | Shops, beats, addresses, phones, GSTINs                                                    |
| `DateWiseOutStanding.xlsx`    | Outstanding report, one row per **open bill**. **Run on 20 July 2026** (see §5)                 | 131 bills, 99 customers                    | Opening receivables                                                                        |
| `SalesGstGSTWISE.xlsx`        | August 2026 GST sales register, one row per bill and GST slab                                   | 548 rows, 542 bills, 295 customers         | Corroborates customers (GSTIN, state). No item lines, so it cannot feed buying history     |
| `Sales GST 1AUG.rpt`          | Crystal report **definition** (OLE2 file, "GSTNO WISE Sales GST For The Period From")           | —                                          | Nothing. It holds the layout and no saved data (no customer name occurs in it). Not parsed |
| `TE2627.bak`                  | SQL Server full backup of the FY 2026-27 books (`OCS_DB2`), 34.7 MB, **uncompressed**           | 199 tables, 3 214 data pages, 43 with rows | Read by our own page reader (§8). Item master, purchases, accounts, sales bills, receipts  |
| `DBFmcg.bak`                  | SQL Server backup of the software's own configuration database (`DBPharma`), 4 MB, uncompressed | 16 tables                                  | Nothing to import: application logins, menus, help text. It does read with the same reader |

## 2. Column → field mapping

Everything is keyed by the old software's own identity, so a second run finds what the first wrote.

### Product list → catalogue

| Column                                          | Becomes                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ITEM_CODE`                                     | The identity. Product, variant, listing, price and cost ids are derived from `(tenant, ITEM_CODE)`                                                                   |
| `ITEM_TITLE`                                    | `products.name` and `product_variants.name` (as printed; no case change)                                                                                             |
| `MFG_NAME` (`MFG_CODE`)                         | `manufacturers` (global row, matched by name case-insensitively, created once). It is the **company**, not a brand: no brand                                         |
| `HSN_NO`                                        | `product_variants.hsn_code`. A spreadsheet drops leading zeros, so an odd-length code gets one back (`8135020` → `08135020`); with `--bak` the backup's text is used |
| `GST` (5 / 40)                                  | `hsn_rates.gst_bps` for that HSN (500 / 4000), cess 0. See "HSN rates" below                                                                                         |
| `SALE_PRICE`                                    | `price_list_items.rate_paise`, **per legacy unit, before GST** (`inclusive_of_gst = false`), on one default list "Legacy price list"                                 |
| `MRP_PRICE`                                     | `product_variants.mrp_paise` and the MRP of the opening lot                                                                                                          |
| `Status` (`ACTIVE`)                             | `tenant_products.listed = active AND priced`                                                                                                                         |
| `ITEM_PACK` (`EACH`, `CASE`, `CASES`, `250ML`…) | Not a pack size: the unit the price is quoted in. Counted in the report only                                                                                         |
| `SDISP_TAX`, `OCT_PER`, `CO_CODE`, `MARGIN_PER` | Ignored (0 on every row except `MARGIN_PER` = 20 on two)                                                                                                             |

**One legacy unit is one piece with a case size of 1.** No source gives pieces per carton (see §7), and a legacy price
is per legacy unit, so quantities, prices and stock stay consistent: a "CASE" item is sold, priced and stocked in
cases. The owner sets a real case size afterwards with `caseSizeOverride` on the listing (the catalogue screen);
that never changes a price.

Products are created through `CatalogService.propose` as **`proposed`** rows (ADR 0005: a distributor's proposal is
usable at once). They are global rows, so every distributor's catalogue search sees them until a curator merges or
rejects them.

**HSN rates** (the S-176 / S-177 rule, migrations 0060 / 0061: one live rate per HSN). Per heading the plan takes the
rate the list gives it. A heading the list gives **two** rates keeps the majority and refuses the rest (none happens in
this data). At write time, for each heading: live rate equal → nothing; no row → a row effective `--rates-from`
(default **2025-09-22**, the GST 2.0 slab date); a live row with another rate that is **older** than `--rates-from` →
a new dated row on top of it (the old row is left alone: "a rate CHANGE is a new row with a later `effective_from`");
a live row dated on or after `--rates-from`, or any future-dated row → the heading is **held back** and its items are
skipped, so a load never overrides a curator's newer rate. Global rows are written with `withTenant` as the `curator`
actor, which is what the row-level policy admits.

Items with **no HSN** in the list (17) get the heading for their GST rate: 40 % → `2202` (aerated and flavoured
drinks), 5 % → `22029920` (fruit-juice-based drinks). This is a classification the importer **assumed**; the report
counts them (`hsn-assumed`) and `--hsn-fallback` / `--no-hsn-fallback` change or refuse it.

### Customer master (PDF, then the backup's `m_accmas`) → shops

| PDF field / backup column                       | Becomes                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `CODE` / `CASH_ACC`                             | `external_party_codes(system = 'tradeezee', code)` and the shop's deterministic id; `retailers.code` (R-0001…) is the app's |
| `PARTY NAME` / `ACC_TITLE`                      | `retailers.name` (≤ 120 characters)                                                                                         |
| `Address Line1`, `Line2` + `Line 3`             | `address.line1`, `address.line2` (2 and 3 joined by a comma)                                                                |
| `Area Name` / `AREA_CODE` → `m_area`            | A **beat** per area (created through `upsertBeat`, no visit days) and `address.area`                                        |
| `Pincode` / `ACC_PIN`                           | `address.pincode` when it is 6 digits (`0` is dropped)                                                                      |
| `Telephone no` / `ACC_TEL`                      | `retailers.phone` as `+91…`; **blank** when it is `0` or not a mobile (a blank phone is a supported state)                  |
| `GST NO.` / `GST`, and the GST register's `GST` | `retailers.gstin` only when its check digit holds (PDF first, then the backup, then the register); `gst_reg_type = regular` |
| state                                           | The GSTIN's first two digits, else the register's `STATE`, else the backup's `State`, else `--default-state` (27)           |
| `ACC_PROP` (backup), `ACC_TEL1` (backup)        | Owner name is imported; the second phone is **planned but not written** (§6)                                                |
| `Food License`, credit limit/days               | Not imported (§6)                                                                                                           |

Shops are written with `RetailersService.upsertFromImport` (the generic importer's own function) and the code is
remembered with `linkExternalCode`, so the next file auto-matches. **No credit limit, days, tier or mode is set**
(the same rule as the generic importer: those go through `retailers.setCredit`, one shop at a time).

### Outstanding → opening receivables

There is a mechanism and the tool uses it; nothing was invented. `BillingService.recordOpeningInvoice` stores each bill
as an `invoices` row with `source = 'import'` in the external series and calls `ReceivablesService.postOpeningBalance`
(DR Accounts receivable / CR Opening balance equity), so bill-to-bill allocation and ageing work from day one, with no
stock and no order. It is the same pair the generic importer's `opening_outstanding` target calls.

| Column                             | Becomes                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `BOOK_CODE + SAL_YEAR + BILL_NO`   | The identity of the bill (its invoice id is derived from it) and, when unique, the printed number (`BILL_NO`)                    |
| `CASH_ACC`                         | The shop (through the code the shops step remembered)                                                                            |
| `BILL_DATE`, `DUE_DATE`            | `invoice_date`, `due_date`                                                                                                       |
| `SAL_AMT − TOT_RCT`                | The invoice **total and the receivable**: what is still owed. The original amount and the part received stay in the old software |
| `SALESMAN`, `CRDAYS`, `Delay_Days` | Ignored (`SALESMAN` is empty on every row)                                                                                       |

The generic wizard could not take this file as it is: its `opening_outstanding` target wants one column with the
outstanding amount per bill, and the sheet has an amount and a received column. The tool computes the difference. A
bill whose number is already another external bill's keeps book and year in its number (`GL-2026-129`).

### Backup tables → what they add (`--bak`, found automatically in `--dir`)

| Table                             | Used for                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `m_itemas` (84)                   | `HSN_NO` as text; `ITEM_CLBL` = closing balance in legacy units → the **opening stock**; `ITEM_ACT`                              |
| `PURDAT` + `PURDET`               | Latest supplier bill per item (`IN_TYPE = 'P'`): `BILL_PRICE` → purchase rate, `COST_PRICE` → landed cost, `MRP_PRICE`, supplier |
| `m_accmas` (694)                  | The customers the PDF lacks (8 created after it was printed), second phone, owner name, GSTIN, state; five **suppliers**         |
| `m_area` (21)                     | Area code → area name                                                                                                            |
| `saldat` + `salrct` + `salrctdet` | The sales ledger: bills, receipts and their dates → `--outstanding-from-backup` (§5)                                             |

Costs go through `TenantCatalogService.upsertCost` (back-office only), suppliers through `upsertSupplier`, opening stock
through `InventoryService.findOrCreateLot` (batch `OPENING`, the MRP as the lot's) and `post` with reason `opening` into
the godown.

## 3. How it writes, and why a re-run changes nothing

Order: manufacturers → HSN rates → products and listings → price list → suppliers → costs → beats → shops → opening
bills → (opening stock). Every id is derived from the legacy key (`legacy/ids.ts`), and every step first asks whether
the id is there. One unit per transaction, like the generic importer's commit run: a bad row is counted and named on the
terminal and the others still land; a crash is healed by running again.

The consequence to know: **the import is a load, not a sync.** A second run never overwrites what the distributor has
edited since (a price, a phone number, a case size). `writer.spec.ts` proves both halves.

## 4. Results on the scratch database `dos_test_legacy_import`

Migrated with `pnpm db:migrate`, then bootstrapped with `infra/docker/bootstrap.mjs` (the deploy's own script; not
`db:seed`). The databases `dos` and `dos_test_hosted` were never touched. Each variant was run **twice on a fresh
database**; after the second run every count and a checksum of the shops, invoices, price rows and listings (including
`updated_at`) were **identical** to the first run's.

| Step                | Run 1: sheet outstanding  | Run 1: backup ledger (as of 26 Sep) | Run 2 (both) |
| ------------------- | ------------------------- | ----------------------------------- | ------------ |
| manufacturers       | 6 created                 | 6                                   | 6 unchanged  |
| HSN rate rows       | 13 created                | 13                                  | 13 unchanged |
| products / listings | 84 / 84                   | 84 / 84                             | unchanged    |
| price list items    | 76 (+ 8 unpriced skipped) | 76                                  | unchanged    |
| costs               | 76                        | 76                                  | unchanged    |
| suppliers           | 5                         | 5                                   | unchanged    |
| beats               | 15                        | 15                                  | unchanged    |
| shops               | 685                       | 685                                 | unchanged    |
| opening bills       | **131** (99 shops)        | **206** (134 shops)                 | unchanged    |
| receivable          | ₹2,44,162.00              | ₹3,40,413.00                        | unchanged    |
| opening stock       | 75 lots, 42 398 units     | 75 lots, 42 398 units               | unchanged    |
| failures            | 0                         | 0                                   | 0            |

The ledger was checked against the plan after each write: AR = the sum of the bills (`24 416 200` and `34 041 300`
paise), and OPENING is its mirror. Then the application's own services read the loaded database back and the
contract's output schemas parsed every result: shops list, tenant catalogue, outstanding register (99 shops, the same
₹2,44,162.00, all in the 61-90 and 90+ day buckets), import invoices (131, `issued`), and a `pricing.quote` for one
shop with one 5 % and one 40 % line returned tax of ₹184 on ₹600 (5 % of ₹160 and 40 % of ₹440).

Automated: `pnpm --filter @dos/tools test` — **74 tests in 7 files** (69 pure, 5 against a real Postgres, which build
their own synthetic distributor and skip without `DATABASE_URL`), plus `pnpm --filter @dos/tools lint` and `typecheck`,
all green; `pnpm format:check` is clean for the new files.

## 5. The outstanding report is not the ledger (read this before cut-over)

- The report was **run on 20 July 2026**: for 130 of its 131 rows `DUE_DATE + Delay_Days` is 2026-07-20 (the other row
  has 15 credit days and its delay is counted from the bill date, which is why it points at 4 August). Its bills run from
  4 June to 19 July. It is two months older than the customer PDF (18 Sep) and the backup (26 Sep).
- Rebuilt from the backup's own ledger for the end of 19 July (`deriveOpenBills`: each bill's `SAL_AMT` minus the
  receipts `salrctdet` says were dated up to then), the report and the ledger **agree bill for bill where both have
  the bill: 125 of the report's 131 bills are found, 124 with the same balance** (the receipts logic is reproduced
  exactly). Six of the report's bills are not in the backup any more (deleted from the books afterwards, ₹4,945.00).
- The ledger also holds **25 open bills the report does not list (₹81,002.00)**; 24 are dated before the report's first
  bill (15 – 31 May): the report was run with a date range that starts on 4 June.
- For 26 September the ledger says **206 bills, ₹3,40,413.00, 134 shops** open; the report says 131 bills, ₹2,44,162.00.
  Of the report's 125 bills that the backup still has, only 16 are open on 26 September (the rest were paid in the two
  months since), and 181 of the 206 open bills (₹3,13,204.00) were sold after 19 July.
- So the sheet alone would open the books with a stale, range-filtered receivable. Two ways to fix it, both supported:
  export the outstanding again **on the cut-over day without a date filter**, or load with
  `--outstanding-from-backup --as-of <cut-over day>` from a fresh backup. The importer prints this comparison whenever the
  sheet and the backup are both given.

## 6. What was NOT imported, and why

| Not imported                                                                            | Why                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Salesmen / staff**                                                                    | There are none to import: `SALESMAN` and `SMAN_ACC` are empty on all 131 bills, `SMAN_CODE` is blank on every account and `m_emp` has no rows. And a staff account needs a temporary password (`tenancy.staff.create`), which an importer must not invent. Add staff in the app                             |
| Item-level sales history (suggested orders)                                             | `saldet` (the bill lines) cannot be read: 55 columns are declared but its records carry a 4-byte column more (one was dropped or re-typed), so the reader refuses it rather than return shifted numbers. The Aug GST register has no lines. `RetailersService.recordPurchaseHistory` is ready to receive it |
| Pieces per case                                                                         | In none of the sources (see §7)                                                                                                                                                                                                                                                                             |
| Second phone (62 shops)                                                                 | `RetailerImportValues` has no `altPhone`. Smallest change if wanted: add the field to `upsertRetailerFromImport` (one column, no schema change)                                                                                                                                                             |
| Credit limits and days                                                                  | Every account has a limit of 9 999 999.99 (i.e. none) and `ACC_CRD` (credit days) is 0 for all but three accounts. The rule stands: credit is set per shop in the app. All shops open in credit mode `indicate`                                                                                             |
| Food licence numbers                                                                    | 668 shops say `NA`; six have a number. The licence lives on the global retailer identity, which a tenant import must not write                                                                                                                                                                              |
| Salesman commission, schemes, targets, e-invoice and PiPay tables, the 156 empty tables | Not part of the extracts asked for; the backup holds them but they are software-specific                                                                                                                                                                                                                    |
| The 8 unpriced items' stock (3 984 units)                                               | A lot's identity includes the printed MRP (ADR 0003) and neither the list nor any purchase gives these 8 items one. They are imported unlisted; their stock waits for an MRP                                                                                                                                |
| A future-dated or newer curator HSN rate                                                | Held back and reported rather than overridden                                                                                                                                                                                                                                                               |

## 7. Data-quality findings (counts only)

**Products (84).** Every HSN heading in the list has exactly one GST rate (**no heading with several rates**), but the
catalogue that migrations 0060/0061 leave behind disagrees with the list on three headings, which is why dated rows
are added: `21069099` (catalogue 12 %, list 5 %), `22029920` (12 % vs 5 %) and packaged water (catalogue `2201` at 18 %;
the list uses `220110` and `22011010` at 5 %). 17 items have **no HSN** (15 at 40 %, 2 at 5 %); three HSN values lost a
leading zero. 8 items have **no price and no MRP** (one supplier's range) and are imported unlisted. 7 items are priced
below half their MRP. **`SALE_PRICE` is not a curated selling price**: for all 76 priced items it equals the sale price
on the latest purchase batch, and for **36 of them it equals the purchase cost** (zero margin), so review the price list
before selling; 61 of 76 look GST-exclusive (price ≤ MRP ÷ (1 + GST)). Price units: 49 `EACH`, 29 `CASE(S)`, 6 size labels
whose price is nonetheless per carton. Pieces per carton is nowhere: every purchased item's supplier-bill quantities
share a common factor (90, 100, 36, 250, 144 …), which suggests case sizes — but 32 of 76 were bought once, so it is a
hint for the founder, not data.

**Customers (677 in the PDF, 685 with the backup).** No two names are equal, but **5 pairs are near-duplicates** by
trigram (≥ 0.8), and **20 shops repeat another shop's phone number**; the report flags them and merges nothing. 269 have
no usable phone (263 print `0`), 661 have no GSTIN (16 do, all valid; 17 after the backup), 15 areas, no blank area.
Two bills carry a different spelling of the shop's name than the master (same code). One account is in Other Territory
(state 98), which is not a place a shop sits in: the shop takes state 27.

**Outstanding (131 bills).** No bill has `TOT_RCT` above `SAL_AMT`, none is fully settled, **9 are partly received**
(₹13,223.00 in all, imported as the balance), no repeated bill key, no blank area. ₹1,36,843.00 of the ₹2,44,162.00 is
61–90 days old on 26 September and ₹1,07,319.00 is older. All 99 shops are in the master.

**GST register (548 rows).** 6 bills sit on two rows (two slabs: 5 % and 40 %); 11 rows carry a GSTIN (5 distinct ones); three
rows are "Other Territory". All 295 customers are in the master.

## 8. The backup reader (the time-boxed part)

It works, for these two files, and it is small (`legacy/mssql-bak.ts`, ~400 lines, pure TypeScript, no SQL Server).

- Both files are **uncompressed**: an MTF container (`TAPE`, `SSET`, `VOLB`, `FILE` blocks) whose database pages sit in
  it exactly as they sat on disk, in extent order with the unallocated extents left out (so page N is not at N × 8 KB).
  A backup taken `WITH COMPRESSION` would not read this way.
- Data pages are found by sniffing every 512-byte boundary for a plausible page header (version 1, type 1, data file 1,
  a slot array that points back inside the page). The catalogue is read from its own base tables by object id
  (`sysschobjs` 34, `syscolpars` 41, `sysrowsets` 5, `sysallocunits` 7) and joined through the allocation-unit id to the
  pages of each table. Records use the row format every version since 2005 shares (status bytes, fixed columns, column
  count, null bitmap, variable-column end offsets).
- **It refuses rather than guesses**: a table whose records do not have the fixed-area size its declared columns add up
  to throws a named error. One user table trips it, `saldet`, plus scratch report tables. The physical layout of a
  re-typed table lives in `sysrscols`; decoding it is the next step if item-level sales history matters.
- Checked against the founder's own numbers: the item master gives the same 84 items as the sheet, the customer table
  agrees with the PDF on names and phones for 676 of 677 shops, and the sales ledger reproduces the outstanding report to
  the paisa on 124 of the 125 bills both have (§5).
- The reader is covered by specs on synthetic pages (a hand-assembled record, a builder for whole mini backups with gaps
  between pages, ghosts and forwarding stubs, a dropped-column table).

## 9. Decisions the founder owes

1. **Which outstanding opens the books?** Re-export it on the cut-over day without a date filter, or load from a fresh
   backup with `--outstanding-from-backup --as-of <day>`. Not the 20 July sheet (§5). Also pick **one cut-over day** for
   receivables, stock and prices: today they span 19 July, 18 Sep and 26 Sep.
2. **Case sizes.** Give a sheet (item → pieces per case), or accept "one legacy unit = one piece" and set case sizes on
   the catalogue screen. Nothing else in the import depends on it, but ordering "by the case" will not work until then.
3. **Prices.** Confirm `SALE_PRICE` is the price to sell at, GST-exclusive, per legacy unit. 36 items are priced at their
   purchase cost. The 8 unpriced items stay unlisted until priced.
4. **HSN and GST rows** (global, visible to every distributor): confirm with the CA the rates in the list (5 % and
   40 % from 2025-09-22), and the two headings the importer had to assume for the 17 items with no HSN (`2202` at 40 %,
   `22029920` at 5 %). Confirm the effective date (`--rates-from`).
5. **Global catalogue.** The products load as `proposed` global rows; the manufacturers as global rows. Say whether a
   curator should accept them, or whether Tarsun's SKUs should be curated before other distributors see them.
6. **Shops without a phone (269).** They load with a blank phone: they cannot be reminded, invoiced by WhatsApp or invited
   to the retailer app until one is entered. Decide whether they load anyway (the default) or wait for phones. And the
   20 shops sharing a number and the 5 probable duplicate pairs: merge in the app, or leave.
7. **Credit terms.** The old software had none. Decide per shop (or a default) after the load.
8. **Suppliers (5) and costs.** Loaded from the backup. Confirm `BILL_PRICE` is the supplier's rate and `COST_PRICE` the
   landed cost, both before GST, and whether the founder wants them at all.
9. **Opening stock.** 46 382 units in 83 items by `ITEM_CLBL`, one lot `OPENING` per item at the item's MRP. 8 items
   (3 984 units) wait for an MRP. Confirm the count against a physical stock-take before trusting it: the running
   balance and the sum of the purchase batches differ on 25 items.
10. **Salesmen and staff.** None in the data; add them in the app.

## 10. Changes that would help, each small and each for the founder to approve

- `altPhone` on `RetailerImportValues` / `upsertRetailerFromImport` (62 shops).
- Decode `sysrscols` in the backup reader to read `saldet`, then feed `RetailersService.recordPurchaseHistory` (the
  suggested-order engine's history; the service exists and is used by the generic importer's `sales_register` target).
- A `--rates-from` recorded once per tenant, if the founder wants the effective date kept with the rows.
