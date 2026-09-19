# Money repair — sign-off list

**For: the founder. Date of this list: 19 September 2026.**
**Database examined: `dos_test_q3_repair` (a safe copy, taken after the 48-migration upgrade). Nothing was changed. Every statement run was a read.**

---

## The short answer

**No wrong money was found. There is nothing for you to sign off, and nothing will be appended.**

That is the good outcome, not a failure — but the reason matters, and it is not the reason we expected.

**There is no wrong money in this database because there is no real money in it.** Every receipt, every trip and every ledger line in it was written by the demo seed (`pnpm db:seed`), not by anybody using the apps. All 254 receipts were inserted in one burst on 8 September 2026 — Tarsun's 83 receipts were written over **0.36 seconds**, Kalyan's 84 over 0.31 seconds, Sai's 84 over 0.40 seconds — while the dates printed on them are backdated to 22 August – 4 September. The dates on the paper are made up; the clock that actually stamped the rows shows a single sub-second write.

So the three distributor names you see in here — **M/s. Tarsun Enterprise**, **Kalyan Agencies**, **Sai Distributors** — are all demo books of the same shape, with the amounts scaled differently. None of them is Tarsun's real trade.

**This means the job you asked for cannot be done here, and should not be faked.** Appending balancing entries against invented rows would put false money into the book — which is exactly what your 14 September ruling (correct by adding, never by editing) exists to prevent. The one honest action is to stop and tell you.

---

## Trips examined

| Distributor | Trips in the book | Trip dates | Settled trips | Trips needing a correction |
|---|---|---|---|---|
| M/s. Tarsun Enterprise | 18 | 26 Aug – 5 Sep 2026 | 14 | **0** |
| Kalyan Agencies | 17 | 26 Aug – 4 Sep 2026 | 13 | **0** |
| Sai Distributors | 17 | 26 Aug – 4 Sep 2026 | 13 | **0** |

There is no per-trip section below, because there is no trip with a wrong figure on it. Nothing is being appended, so **there is no "did the crew hand that cash over, or is it still with them?" question to put to you on any trip.**

## Totals

| Distributor | Cash the book says the crews carried | Amount to be corrected |
|---|---|---|
| M/s. Tarsun Enterprise | ₹4,19,516.52 | **₹0.00** |
| Kalyan Agencies | ₹3,84,555.63 | **₹0.00** |
| Sai Distributors | ₹4,13,620.11 | **₹0.00** |
| **Overall** | | **₹0.00** |

---

## The three ways money usually goes wrong — each checked, each clean

**1. The same money banked twice.** Not found. There are exactly three bank deposits in the whole book, one per distributor, all on 3 September under reference DEP/2026/0117: Tarsun **₹46,414.00**, Kalyan **₹44,997.00**, Sai **₹55,654.00**. Each deposit line matches the cheques behind it **to the paisa, with nothing left over**. Checked from the other side too: the cheques the book still says are in hand — Kalyan ₹68,173.00, Sai ₹65,143.00, Tarsun ₹46,990.00 — agree exactly with the cheque account balance. If a cheque had been banked twice, that balance would have fallen short. It does not.

**2. Van cash missed when the trip was settled.** No correctable instance (see the caution below about the demo figures).

**3. A receipt undone after the day was closed, taking back cash the crew had already handed over.** Not found. There are nine undone receipts, three per distributor, and **not one of them was on a trip**. Each is a matched pair that cancels itself exactly: a ₹2,000.00 office cash receipt entered in error and reversed, and a bounced cheque reversed with its ₹350.00 bank charge. No van cash is touched by any of them.

---

## What we found instead — demo-data problems, not money problems

These are real defects, but they belong with the demo-data items already queued in `docs/23` §10. **They are not money to correct and nothing here should be appended to any book.**

- **The demo's trip figures were built from the wrong table.** Each settlement's cash figure agrees with the `collections` table but not with the `receipts` register that the live settlement code actually reads. **44 of the 48 settled trips disagree** — by ₹2,48,114.37 in Kalyan, ₹2,38,202.89 in Sai, ₹2,26,218.48 in Tarsun. Beneath it, 33 collection rows record a different amount from the very receipt they point at (Tarsun 13, Kalyan 10, Sai 10).
- **Consequence:** this database is **not safe to use as a test fixture for settlement behaviour**. Run the real settlement code over it and it will compute a different expected cash than the stored row on 44 of 48 trips.
- **There is not one trip-settlement posting in the entire book** — 51 settlement rows exist, zero postings. So van cash is debited on every trip and never credited back. In a real book that would be the "is the cash still with the crew?" question on every single trip; here it is simply a seed that never ran the settlement code.
- **No reversal was ever stamped.** 522 ledger entries, **0** marked as reversed — further proof the seed wrote the ledger directly and the application's own posting code never ran.

---

## What this repair does NOT touch

- **Nothing was edited. Nothing was deleted. Nothing was added.** Not on the copy, and not anywhere else. Every statement run against `dos_test_q3_repair` was a read. Had there been a correction to make, it would have been **one added entry per wrong figure** — and that added entry is itself reversible by another added entry. That is the only way money is ever corrected here.
- **Your live database `dos` was never connected to**, nor `dos_qa`, nor any template. All of this was read from the copy.
- **Retailer balances, invoices, stock and credit limits were not touched** and are not part of this list.
- **The demo-data defects above were not fixed** — fixing them is a code-and-seed job for the queued backend slice, not a sign-off item.
- **Alerts on your phone are not touched by any of this.** Nothing in the repair work sends you anything. If you want alerts to reach your phone, **Remote Control has to be switched on by you in the app** — that switch is yours, not something this work can turn on. Today nothing reaches your phone.

---

## Evidence — every figure above, with the query that produced it

All amounts are stored as **integer paise**; the rupee figures above are those paise divided by 100, and nowhere else is any conversion applied. Connection verified before anything else: `select current_database(), current_user` → `dos_test_q3_repair | dos`.

**Trips, dates and settled counts**
```sql
select t.slug, t.legal_name, count(*) as trips, min(tr.trip_date), max(tr.trip_date),
       count(*) filter (where tr.state='settled') as settled
from trips tr join tenants t on t.id=tr.tenant_id group by t.slug, t.legal_name order by t.slug;
```
→ tarsun 18 trips, 2026-08-26 → 2026-09-05, 14 settled; kalyan-agencies 17, 2026-08-26 → 2026-09-04, 13; sai-distributors 17, same dates, 13. (A fifth row, `a-ca706f30` "Tenant A", 6 trips, is a leftover spec fixture, not a distributor.)

**Cash the crews carried**
```sql
select t.slug, count(*) as cash_receipts_on_a_trip, sum(r.amount_paise)
from receipts r join tenants t on t.id=r.tenant_id
where r.trip_id is not null and r.mode='cash' and r.status<>'cancelled' and r.reverses_receipt_id is null
group by t.slug order by t.slug;
```
→ tarsun 26 receipts / 41951652 paise (₹4,19,516.52); kalyan 25 / 38455563 (₹3,84,555.63); sai 25 / 41362011 (₹4,13,620.11).

**Everything was written by the seed in one burst**
```sql
select t.slug, count(*) as receipts, min(r.created_at) as first_insert,
       max(r.created_at)-min(r.created_at) as insert_window,
       min(r.received_at)::date, max(r.received_at)::date
from receipts r join tenants t on t.id=r.tenant_id group by t.slug order by t.slug;
```
→ tarsun 83 receipts, first insert 2026-09-08 06:26:06.881942+05:30, window **00:00:00.360885**, business dates 2026-08-22 → 2026-09-04; kalyan 84 / 06:26:10.894895 / 00:00:00.313282; sai 84 / 06:26:09.830501 / 00:00:00.404904. Corroborated in code: the demo seed inserts ledger rows directly — `insertMany(db, journalEntries, entryRows)` at `backend/libs/database/src/seed-demo/receivables.ts:818` — so `ReceivablesService.recordReceipt` never ran for any of these rows.

**Direction convention, settled from the data before relying on it** (positive = debit, negative = credit)
```sql
select i.invoice_no, i.total_paise,
       sum(jl.amount_paise) filter (where a.code='AR') as ar_line,
       sum(jl.amount_paise) filter (where a.code='SALES') as sales_line,
       sum(jl.amount_paise) as entry_sum
from invoices i
join journal_entries je on je.tenant_id=i.tenant_id and je.ref_type='invoice' and je.ref_id=i.id
join journal_lines jl on jl.entry_id=je.id join accounts a on a.id=jl.account_id
where i.tenant_id='01a07e83-dd8f-731a-9000-640587b1ee61'
group by i.invoice_no, i.total_paise order by i.invoice_no limit 3;
```
→ INV/0001 total 2332500, AR **+2332500**, SALES −1776072, entry sums to 0; INV/0002 2038400 / +2038400 / −1735104 / 0; INV/0003 1486000 / +1486000 / −1088952 / 0. Money owed to us (an asset) rises **positive** by exactly the bill total. Code agrees: `backend/libs/core/src/modules/receivables/posting.ts:11`.

**Every book balances**
```sql
select t.slug, sum(jl.amount_paise) as book_sum, count(*) as lines
from journal_lines jl join tenants t on t.id=jl.tenant_id group by t.slug order by t.slug;
```
→ tarsun 0 (647 lines), kalyan 0 (638), sai 0 (638), fixture 0 (6).

**(1) Banked twice — each bank line against the receipts that justify it**
```sql
select t.slug, je.ref_type, je.entry_date, jl.amount_paise as bank_line,
 (select coalesce(sum(r.amount_paise),0) from receipts r
    where r.tenant_id=je.tenant_id and r.deposit_ref=je.ref_id) as receipts_with_that_ref,
 jl.amount_paise - (select coalesce(sum(r.amount_paise),0) from receipts r
    where r.tenant_id=je.tenant_id and r.deposit_ref=je.ref_id) as residual_paise
from journal_lines jl join accounts a on a.id=jl.account_id and a.code='BANK'
join journal_entries je on je.id=jl.entry_id join tenants t on t.id=jl.tenant_id
order by t.slug, je.entry_date;
```
→ 10 bank lines. The three deposits leave **residual exactly 0**: tarsun 4641400 (₹46,414.00), kalyan 4499700 (₹44,997.00), sai 5565400 (₹55,654.00). The other seven are not deposits and justify themselves: one 638400 (₹6,384.00) bank-transfer receipt per distributor, one −35000 (₹350.00) bounce charge per distributor, one 41867 (₹418.67) claim settlement in Tarsun.

**(1b) Cheques still in hand, tied from the opposite side**
```sql
select t.slug, sum(jl.amount_paise) as cheques_balance_paise,
 (select coalesce(sum(r.amount_paise),0) from receipts r
    where r.tenant_id=t.id and r.mode='cheque' and r.status='collected') as cheques_in_hand_per_receipts
from journal_lines jl join accounts a on a.id=jl.account_id and a.code='CHEQUES'
join tenants t on t.id=jl.tenant_id group by t.slug, t.id order by t.slug;
```
→ kalyan 6817300 = 6817300 (₹68,173.00), sai 6514300 = 6514300 (₹65,143.00), tarsun 4699000 = 4699000 (₹46,990.00). Exact on all three.

**(1c) The banked rows listed positively, rather than relying on a zero-row query**
```sql
select t.slug, r.receipt_no, r.mode, r.amount_paise, r.status, r.deposited_at, r.deposit_ref,
       (r.trip_id is not null) as on_a_trip
from receipts r join tenants t on t.id=r.tenant_id
where r.deposited_at is not null or r.status='deposited' or r.deposit_ref is not null
order by t.slug, r.receipt_no;
```
→ exactly 6 rows (RCPT-CHQ-0003 and -0004 in each distributor), all cheques, all deposited 2026-09-03 11:00 under DEP/2026/0117, **none on a trip**.

**(2) Trip cash at settlement — tie against both candidate registers**
```sql
with rec as (select r.tenant_id, r.trip_id,
        coalesce(sum(r.amount_paise) filter (where r.mode='cash'),0) as cash_receipts
      from receipts r where r.trip_id is not null and r.reverses_receipt_id is null
        and r.status<>'cancelled' group by 1,2),
col as (select c.tenant_id, c.trip_id,
        coalesce(sum(c.amount_paise) filter (where c.mode='cash'),0) as cash_collections
      from collections c group by 1,2)
select t.slug, count(*) as settlements,
 count(*) filter (where (ts.expected_cash_paise - tr.opening_cash_paise + ts.expenses_paise)
                        = coalesce(col.cash_collections,0)) as ties_to_collections,
 count(*) filter (where (ts.expected_cash_paise - tr.opening_cash_paise + ts.expenses_paise)
                        = coalesce(rec.cash_receipts,0)) as ties_to_receipts,
 sum(abs((ts.expected_cash_paise - tr.opening_cash_paise + ts.expenses_paise)
         - coalesce(rec.cash_receipts,0))) as divergence_vs_receipts_paise
from trip_settlements ts
join trips tr on tr.id=ts.trip_id and tr.tenant_id=ts.tenant_id
join tenants t on t.id=ts.tenant_id
left join rec on rec.tenant_id=ts.tenant_id and rec.trip_id=ts.trip_id
left join col on col.tenant_id=ts.tenant_id and col.trip_id=ts.trip_id
group by t.slug order by t.slug;
```
→ kalyan 16 settlements: 16 tie to `collections`, **4** tie to `receipts`, divergence 24811437 paise (₹2,48,114.37); sai 16 / 16 / 4 / 23820289 (₹2,38,202.89); tarsun 16 / 16 / 4 / 22621848 (₹2,26,218.48). The settlement code reads the **receipts** register (`ReceivablesService.tripMoney`, `backend/libs/core/src/modules/receivables/receivables.service.ts:630-664`, used at `delivery/settlement.service.ts:390`), so the agreement with `collections` is a property of how the seed was written, not of the money.

**(2b) The collection rows disagree with the receipts they point at**
```sql
select t.slug, count(*) as collection_rows,
 count(*) filter (where r.id is null) as collections_with_no_receipt,
 count(*) filter (where r.id is not null and r.trip_id is distinct from c.trip_id) as trip_mismatch,
 count(*) filter (where r.id is not null and r.amount_paise <> c.amount_paise) as amount_mismatch
from collections c join tenants t on t.id=c.tenant_id
left join receipts r on r.id=c.receipt_id and r.tenant_id=c.tenant_id group by t.slug order by t.slug;
```
→ tarsun 40 rows / **13** amount mismatches, kalyan 41 / **10**, sai 41 / **10**; trip ids always agree.

**(2c) No trip-settlement posting exists at all**
```sql
select ref_type, count(*) from journal_entries group by 1 order by 2 desc;
select (select count(*) from trip_settlements) as settlement_rows,
       (select count(*) from journal_entries where ref_type like '%settle%') as settlement_postings;
```
→ entry kinds are receipt 253, invoice 216, opening 27, credit_note 6, writeoff 6, claim 4, deposit 3, claim_settlement 3, invoice_cancel 3, test 1 — **no trip-settlement kind at all**, against 51 settlement rows. (The 3 matched by `%settle%` are claim settlements.)

**(3) A receipt undone after day-end, taking back van cash**
```sql
select t.slug, rev.receipt_no as undo_no, rev.status, rev.amount_paise,
 orig.receipt_no as original_no, orig.mode, (orig.trip_id is not null) as original_was_on_a_trip,
 (select string_agg(a.code||':'||jl.amount_paise,' ' order by a.code)
    from journal_entries je join journal_lines jl on jl.entry_id=je.id
    join accounts a on a.id=jl.account_id
    where je.tenant_id=rev.tenant_id and je.ref_id=rev.id) as undo_posting
from receipts rev join tenants t on t.id=rev.tenant_id
left join receipts orig on orig.id=rev.reverses_receipt_id and orig.tenant_id=rev.tenant_id
where rev.reverses_receipt_id is not null or rev.status='cancelled' order by t.slug, rev.receipt_no;
```
→ 9 rows, 3 per distributor, `original_was_on_a_trip` **false on every one**, and no posting touches van cash. Each RCPT-ERR-0001 / -R pair is `AR:−200000 CASH:+200000` then `AR:+200000 CASH:−200000` (₹2,000.00 office cash in and straight back out). Each RCPT-CHQ-0005-R is `AR:+full CHEQUES:−full BANK_CHARGES:+35000 BANK:−35000` — a correctly paired bounce with its ₹350.00 charge.

**One thing that looked wrong and was cleared.** Some receipts credit the amount-owed account by more than the cash they took. All of them are cash-discount receipts and all resolve exactly:
```sql
select t.slug, count(*) as receipts_where_ar_credit_ne_amount,
 count(*) filter (where ar.ar_credit + r.amount_paise + coalesce(r.cash_discount_paise,0) = 0) as explained_by_discount,
 count(*) filter (where ar.ar_credit is null) as no_posting_at_all,
 count(*) filter (where ar.ar_credit is not null
   and ar.ar_credit + r.amount_paise + coalesce(r.cash_discount_paise,0) <> 0) as unexplained
from receipts r join tenants t on t.id=r.tenant_id
join lateral (select sum(jl.amount_paise) filter (where a.code='AR') as ar_credit
  from journal_entries je join journal_lines jl on jl.entry_id=je.id
  join accounts a on a.id=jl.account_id
  where je.tenant_id=r.tenant_id and je.ref_id=r.id) ar on true
where ar.ar_credit is distinct from -r.amount_paise group by t.slug order by t.slug;
```
→ tarsun 7, kalyan 8, sai 8 such receipts; **every one explained by its cash discount, 0 unexplained**. (The 3 fixture rows in `a-ca706f30` carry no ledger entry at all.)

**No reversal was ever stamped**
```sql
select count(*) as entries_total,
       count(*) filter (where reversed_by_entry_id is not null) as entries_stamped_reversed
from journal_entries;
```
→ 522 entries, **0** stamped — although the code does stamp them (`stampReversed`, `backend/libs/core/src/modules/receivables/posting.ts:183`, called from `receivables.service.ts:2092`). More proof the seed wrote the ledger directly.

---

## Compliance

Connected only to `postgres://dos:dos@127.0.0.1:5439/dos_test_q3_repair`, verified by `select current_database(), current_user` → `dos_test_q3_repair | dos`. **Every statement issued was a `SELECT` or a catalog read. No INSERT, UPDATE, DELETE, TRUNCATE, ALTER or DDL was run at any point, on this or any other database.** `dos`, `dos_qa` and the templates were never connected to. All figures are integer paise exactly as stored; rupee figures are those paise divided by 100 and appear only in the reading sections above.
