\pset footer on
\echo '#### CHECK 09 - returns and credit notes (fix DOS-058, known DOS-116)'
\echo '#### Restocking reasons (billing/credit-notes.service.ts): short_delivery, return_saleable, return_damaged, cancellation. Line saleable=true -> sale_return_saleable into the van / ship-from location; false -> sale_return_damaged into the damaged bin. Ledger key credit-note:<note>:<line>.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 09a. restocking credit-note lines (note not draft, invoice line has a lot, qty > 0) vs their own ledger row (by key; seeded rows fall back to note + lot)'
with cl as (
  select cl.tenant_id, cl.id as line_id, cl.credit_note_id, c.credit_note_no, c.reason, c.state, cl.qty_pcs, cl.saleable, il.lot_id
    from credit_note_lines cl
    join credit_notes c on c.id = cl.credit_note_id and c.tenant_id = cl.tenant_id
    join invoice_lines il on il.id = cl.invoice_line_id and il.tenant_id = cl.tenant_id
   where c.reason in ('short_delivery', 'return_saleable', 'return_damaged', 'cancellation')
     and c.state <> 'draft' and il.lot_id is not null and cl.qty_pcs > 0
), mv as (
  select cl.*, sl.id as ledger_id, sl.reason as ledger_reason, sl.qty_delta, sl.by_key, loc.kind as location_kind
    from cl
    left join lateral (
      select x.id, x.reason, x.qty_delta, x.location_id,
             (x.idempotency_key = 'credit-note:' || cl.credit_note_id || ':' || cl.line_id) as by_key
        from stock_ledger x
       where x.tenant_id = cl.tenant_id and x.ref_type = 'credit_note' and x.ref_id = cl.credit_note_id
         and (x.idempotency_key = 'credit-note:' || cl.credit_note_id || ':' || cl.line_id or x.lot_id = cl.lot_id)
       order by 5 desc limit 1) sl on true
    left join locations loc on loc.id = sl.location_id
)
select t.slug, mv.saleable, mv.reason, count(*) as lines,
       count(*) filter (where mv.ledger_id is null) as no_ledger_row,
       count(*) filter (where mv.ledger_id is not null and not mv.by_key) as matched_by_lot_only,
       count(*) filter (where not mv.saleable and mv.ledger_reason = 'sale_return_damaged' and mv.location_kind = 'damaged') as nonsaleable_to_damaged_bin_ok,
       count(*) filter (where not mv.saleable and (mv.ledger_reason <> 'sale_return_damaged' or mv.location_kind <> 'damaged')) as nonsaleable_went_elsewhere,
       count(*) filter (where mv.saleable and mv.ledger_reason = 'sale_return_saleable' and mv.location_kind in ('warehouse', 'vehicle')) as saleable_restock_ok,
       count(*) filter (where mv.saleable and (mv.ledger_reason <> 'sale_return_saleable' or mv.location_kind not in ('warehouse', 'vehicle'))) as saleable_went_elsewhere,
       count(*) filter (where mv.ledger_id is not null and mv.qty_delta <> mv.qty_pcs) as qty_ne_line
  from mv join tenants t on t.id = mv.tenant_id
 group by 1, 2, 3 order by 1, 2, 3;

\echo '== 09b. every sale_return_* ledger row back to its credit-note line: saleable restock only from a saleable line, damaged-bin row only from a non-saleable line'
select t.slug, sl.reason, sl.ref_type, count(*) as ledger_rows,
       count(*) filter (where cl.id is null) as no_line_by_key,
       count(*) filter (where sl.reason = 'sale_return_saleable' and cl.saleable = false) as saleable_restock_from_nonsaleable_line,
       count(*) filter (where sl.reason = 'sale_return_damaged' and cl.saleable = true) as damaged_row_from_saleable_line,
       count(*) filter (where sl.reason = 'sale_return_saleable' and loc.kind not in ('warehouse', 'vehicle')) as saleable_row_outside_selling_location,
       count(*) filter (where sl.reason = 'sale_return_damaged' and loc.kind <> 'damaged') as damaged_row_outside_damaged_bin,
       count(*) filter (where sl.qty_delta <= 0) as non_positive_qty
  from stock_ledger sl
  join locations loc on loc.id = sl.location_id
  join tenants t on t.id = sl.tenant_id
  left join credit_note_lines cl on cl.tenant_id = sl.tenant_id and cl.credit_note_id = sl.ref_id
       and sl.idempotency_key = 'credit-note:' || cl.credit_note_id || ':' || cl.id
 where sl.reason in ('sale_return_saleable', 'sale_return_damaged')
 group by 1, 2, 3 order by 1, 2, 3;
\echo '== 09b2. sale_return_* rows with no credit-note line by key: are they seed rows (created at seed time) or product rows?'
select t.slug, sl.reason, count(*) as rows,
       count(*) filter (where sl.created_at >= timestamptz '2026-09-12 12:52:00+05:30') as created_after_seed,
       (array_agg(sl.idempotency_key order by sl.created_at desc))[1:3] as example_keys
  from stock_ledger sl
  join tenants t on t.id = sl.tenant_id
 where sl.reason in ('sale_return_saleable', 'sale_return_damaged')
   and not exists (select 1 from credit_note_lines cl where cl.tenant_id = sl.tenant_id and cl.credit_note_id = sl.ref_id
                    and sl.idempotency_key = 'credit-note:' || cl.credit_note_id || ':' || cl.id)
 group by 1, 2 order by 1, 2;

\echo '== 09c. KNOWN DOS-116 / DOS-058: damaged or expired returns that went into saleable stock'
\echo '   (i) credit notes with reason return_damaged whose line is saleable or whose ledger row is sale_return_saleable'
select t.slug, c.credit_note_no, c.reason, c.delivery_id is not null as from_doorstep, c.created_at, cl.qty_pcs, cl.saleable,
       sl.reason as ledger_reason, loc.name as location, loc.kind
  from credit_notes c
  join credit_note_lines cl on cl.credit_note_id = c.id and cl.tenant_id = c.tenant_id
  join tenants t on t.id = c.tenant_id
  left join stock_ledger sl on sl.tenant_id = c.tenant_id and sl.ref_type = 'credit_note' and sl.ref_id = c.id
       and sl.idempotency_key = 'credit-note:' || c.id || ':' || cl.id
  left join locations loc on loc.id = sl.location_id
 where c.reason = 'return_damaged' and (cl.saleable or sl.reason = 'sale_return_saleable')
 order by c.created_at;
\echo '   (ii) doorstep delivery lines coded damaged/expired that were returned as saleable (DOS-058 path), before and after the merge'
select t.slug, dl.reason, dl.returned_saleable, count(*) as lines, sum(dl.returned_qty_pcs) as pcs,
       count(*) filter (where dl.created_at >= timestamptz '2026-09-13 00:51:23+05:30') as since_merge,
       (array_agg(left(dl.id, 8) || ' ' || to_char(dl.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')))[1:5] as examples
  from delivery_lines dl join tenants t on t.id = dl.tenant_id
 where dl.returned_qty_pcs > 0 and dl.reason in ('damaged', 'expired')
 group by 1, 2, 3 order by 1, 2, 3;
\echo '   (iii) credit notes raised from those doorstep lines and where their pieces went'
select t.slug, c.credit_note_no, c.reason, c.created_at, dl.reason as doorstep_reason, dl.returned_saleable, dl.returned_qty_pcs,
       string_agg(sl.reason || ' ' || sl.qty_delta || ' @' || loc.kind, ', ') as ledger
  from delivery_lines dl
  join deliveries d on d.id = dl.delivery_id and d.tenant_id = dl.tenant_id
  join credit_notes c on c.delivery_id = d.id and c.tenant_id = d.tenant_id
  join tenants t on t.id = dl.tenant_id
  left join stock_ledger sl on sl.tenant_id = c.tenant_id and sl.ref_type = 'credit_note' and sl.ref_id = c.id
  left join locations loc on loc.id = sl.location_id
 where dl.returned_qty_pcs > 0 and dl.reason in ('damaged', 'expired')
 group by 1, 2, 3, 4, 5, 6, 7 order by c.created_at;

\echo '== 09d. credit-note header = sum of lines; total = taxable + taxes + round-off; |round-off| <= 50'
with ln as (
  select tenant_id, credit_note_id, count(*) as n, sum(taxable_paise)::bigint as taxable, sum(tax_paise)::bigint as tax, sum(line_total_paise)::bigint as total
    from credit_note_lines group by 1, 2
)
select t.slug, c.reason, count(*) as notes,
       count(*) filter (where ln.n is null) as without_lines,
       count(*) filter (where c.taxable_paise <> coalesce(ln.taxable, 0)) as taxable_ne_lines,
       count(*) filter (where c.cgst_paise + c.sgst_paise + c.igst_paise + c.cess_paise <> coalesce(ln.tax, 0)) as tax_ne_lines,
       count(*) filter (where c.total_paise <> c.taxable_paise + c.cgst_paise + c.sgst_paise + c.igst_paise + c.cess_paise + c.round_off_paise) as total_ne_parts,
       count(*) filter (where coalesce(ln.total, 0) <> c.taxable_paise + c.cgst_paise + c.sgst_paise + c.igst_paise + c.cess_paise) as line_totals_ne_header_before_rounding,
       count(*) filter (where abs(c.round_off_paise) > 50) as round_off_over_50,
       (array_agg(c.credit_note_no) filter (where ln.n is null or c.taxable_paise <> coalesce(ln.taxable, 0)
          or c.total_paise <> c.taxable_paise + c.cgst_paise + c.sgst_paise + c.igst_paise + c.cess_paise + c.round_off_paise))[1:5] as examples
  from credit_notes c
  left join ln on ln.tenant_id = c.tenant_id and ln.credit_note_id = c.id
  join tenants t on t.id = c.tenant_id
 where c.state <> 'draft'
 group by 1, 2 order by 1, 2;

\echo '== 09e. over-credit: pieces credited on an invoice line above the pieces billed on it; credit value on a bill above the bill total'
with cq as (
  select cl.tenant_id, cl.invoice_line_id, sum(cl.qty_pcs)::bigint as credited
    from credit_note_lines cl join credit_notes c on c.id = cl.credit_note_id and c.tenant_id = cl.tenant_id
   where c.state in ('issued', 'applied') group by 1, 2
)
select t.slug, count(*) as invoice_lines_credited,
       count(*) filter (where cq.credited > il.qty_pcs + il.free_qty_pcs) as pieces_credited_above_billed,
       (array_agg(left(il.id, 8)) filter (where cq.credited > il.qty_pcs + il.free_qty_pcs))[1:5] as examples
  from cq join invoice_lines il on il.id = cq.invoice_line_id and il.tenant_id = cq.tenant_id join tenants t on t.id = cq.tenant_id
 group by 1 order by 1;
with cv as (
  select tenant_id, invoice_id, sum(total_paise)::bigint as credited from credit_notes where state in ('issued', 'applied') group by 1, 2
)
select t.slug, count(*) as bills_with_credit, count(*) filter (where cv.credited > i.total_paise) as credit_above_bill_total,
       (array_agg(i.invoice_no) filter (where cv.credited > i.total_paise))[1:5] as examples
  from cv join invoices i on i.id = cv.invoice_id and i.tenant_id = cv.tenant_id join tenants t on t.id = cv.tenant_id
 group by 1 order by 1;
COMMIT;
